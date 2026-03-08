import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens,
    getStoredPartsFromMessage
} from '@/app/api/chat/utils';
import { buildWebSearchDecisionPrompts, buildWebSearchGuide, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_DECISION_MODEL = 'deepseek-chat';
const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

/**
 * 将存储的历史消息转换为 DeepSeek（OpenAI兼容）格式
 * DeepSeek 使用标准 OpenAI Chat Completions 消息格式：
 * { role: "user"|"assistant", content: "..." }
 * 
 * 关键：多轮对话中只传递 content，不传递 reasoning_content
 */
async function buildDeepSeekMessagesFromHistory(messages) {
    const result = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;

        const role = msg.role === 'model' ? 'assistant' : 'user';

        // DeepSeek 支持图片：使用 content 数组格式
        const hasImages = role === 'user' && storedParts.some(p => p?.inlineData?.url);

        if (hasImages) {
            const contentParts = [];
            for (const part of storedParts) {
                if (isNonEmptyString(part.text)) {
                    contentParts.push({ type: 'text', text: part.text });
                }
                if (part?.inlineData?.url) {
                    const { base64Data, mimeType } = await fetchImageAsBase64(part.inlineData.url);
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${base64Data}` }
                    });
                }
            }
            if (contentParts.length > 0) {
                result.push({ role, content: contentParts });
            }
        } else {
            // 纯文本消息
            const textParts = storedParts.filter(p => isNonEmptyString(p?.text)).map(p => p.text);
            const text = textParts.join('\n');
            if (text) {
                result.push({ role, content: text });
            }
        }
    }
    return result;
}

export async function POST(req) {
    let writePermitTime = null;

    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
            return Response.json({ error: 'Request too large' }, { status: 413 });
        }

        let body;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }
        if (!Array.isArray(history)) {
            return Response.json({ error: 'history must be an array' }, { status: 400 });
        }

        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const clientIP = getClientIP(req);
        const rateLimitKey = `chat:${auth.userId}:${clientIP}`;
        const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
        if (!success) {
            const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
            return Response.json(
                { error: '请求过于频繁，请稍后再试' },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(retryAfter),
                        'X-RateLimit-Remaining': '0',
                    },
                }
            );
        }

        let user = null;
        try {
            await dbConnect();
            const userDoc = await User.findById(auth.userId);
            if (!userDoc) {
                return Response.json({ error: 'Unauthorized' }, { status: 401 });
            }
            user = auth;
        } catch (dbError) {
            console.error('Database connection error:', dbError?.message);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return Response.json({ error: 'DEEPSEEK_API_KEY is not set' }, { status: 500 });
        }
        // 使用 deepseek-reasoner 作为 API 模型（内置思考模式）
        const apiModel = model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat';

        let currentConversationId = conversationId;

        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? `${prompt.substring(0, 30)}...` : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: title,
                model,
                settings,
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        let deepseekMessages = [];
        const limit = Number.parseInt(historyLimit);
        const isRegenerateMode = mode === 'regenerate' && user && currentConversationId && Array.isArray(messages);
        let storedMessagesForRegenerate = null;

        if (isRegenerateMode) {
            let sanitized;
            try {
                sanitized = sanitizeStoredMessagesStrict(messages);
            } catch (e) {
                return Response.json({ error: e?.message || 'messages invalid' }, { status: 400 });
            }
            const regenerateTime = Date.now();
            const conv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                { $set: { messages: sanitized, updatedAt: regenerateTime } },
                { new: true }
            ).select('messages updatedAt');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = sanitized;
            writePermitTime = conv.updatedAt?.getTime?.();
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            deepseekMessages = await buildDeepSeekMessagesFromHistory(effectiveMsgs);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? safeHistory.slice(-limit) : safeHistory;
            deepseekMessages = await buildDeepSeekMessagesFromHistory(effectiveHistory);
        }

        let dbImageEntries = [];

        if (!isRegenerateMode) {
            // 构建用户消息内容
            if (config?.images?.length > 0) {
                const contentParts = [{ type: 'text', text: prompt }];
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        contentParts.push({
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${base64Data}` }
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
                deepseekMessages.push({ role: 'user', content: contentParts });
            } else {
                deepseekMessages.push({ role: 'user', content: prompt });
            }
        }

        // 存储用户消息到数据库
        if (user && !isRegenerateMode) {
            const storedUserParts = [];
            if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });

            if (dbImageEntries.length > 0) {
                for (const entry of dbImageEntries) {
                    storedUserParts.push({
                        inlineData: {
                            mimeType: entry.mimeType,
                            url: entry.url,
                        },
                    });
                }
            }

            const userMsgTime = Date.now();
            const userMessage = {
                id: userMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: storedUserParts
            };
            const updatedConv = await Conversation.findOneAndUpdate({ _id: currentConversationId, userId: user.userId }, {
                $push: {
                    messages: userMessage
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.();
        }

        const maxTokens = config?.maxTokens;

        const baseSystemPrompt = await injectCurrentTimeSystemReminder(
            typeof config?.systemPrompt === 'string' ? config.systemPrompt : ''
        );
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        const enableWebSearch = config?.webSearch === true;
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);
        const normalizeDecisionMessageText = (value) => {
            if (typeof value === 'string') return value;
            if (Array.isArray(value)) {
                return value.map((item) => {
                    if (typeof item === 'string') return item;
                    if (item && typeof item.text === 'string') return item.text;
                    return '';
                }).join('');
            }
            return '';
        };

        const runDeepSeekDecision = async ({ prompt: decisionPrompt, historyMessages }) => {
            const { systemText, userText } = await buildWebSearchDecisionPrompts({
                prompt: decisionPrompt,
                historyMessages,
            });

            const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: DEEPSEEK_DECISION_MODEL,
                    messages: [
                        { role: 'system', content: systemText },
                        { role: 'user', content: userText }
                    ],
                    stream: false,
                    max_tokens: 200
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`DeepSeek 联网判断失败（${response.status}）：${errorText}`);
            }

            const payload = await response.json();
            const text = normalizeDecisionMessageText(payload?.choices?.[0]?.message?.content).trim();
            if (!text) {
                throw new Error('联网判断未返回有效内容');
            }

            return text;
        };

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch { }

        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 15000;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = '';
                let fullThought = '';
                let citations = [];
                let searchContextTokens = 0;

                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch { }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        const data = `data: ${JSON.stringify(payload)}${padding}\n\n`;
                        controller.enqueue(encoder.encode(data));
                    };

                    let searchErrorSent = false;
                    const sendSearchError = (message) => {
                        if (searchErrorSent) return;
                        searchErrorSent = true;
                        sendEvent({ type: 'search_error', message });
                    };

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url) continue;
                            if (!citations.some((c) => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title });
                            }
                        }
                    };

                    // 博查搜索编排
                    const { searchContextText } = await runWebSearchOrchestration({
                        enableWebSearch,
                        prompt,
                        historyMessages: history,
                        decisionRunner: runDeepSeekDecision,
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        providerLabel: 'DeepSeek',
                        model,
                        conversationId: currentConversationId,
                    });

                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

                    const searchContextSection = searchContextText
                        ? buildWebSearchContextBlock(searchContextText)
                        : '';
                    if (searchContextSection) {
                        searchContextTokens = estimateTokens(searchContextSection);
                        sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                    }

                    // 构建最终请求
                    const finalSystemPrompt = `${baseSystemPrompt}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`;
                    const finalMessages = [
                        { role: 'system', content: finalSystemPrompt },
                        ...deepseekMessages
                    ];

                    // DeepSeek reasoner 使用 max_tokens，上限 65536
                    const requestBody = {
                        model: apiModel,
                        messages: finalMessages,
                        stream: true,
                        max_tokens: Math.min(maxTokens || 65536, 65536),
                    };

                    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`DeepSeek API Error: ${response.status} ${errorText}`);
                    }

                    // 解析 SSE 流式响应
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done || clientAborted) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.trim() || line.startsWith(':')) continue;
                            if (!line.startsWith('data: ')) continue;

                            const dataStr = line.slice(6);
                            if (dataStr === '[DONE]') continue;

                            try {
                                const event = JSON.parse(dataStr);
                                const choice = event?.choices?.[0];
                                if (!choice) continue;

                                const delta = choice.delta;

                                // DeepSeek reasoner 的思考过程通过 reasoning_content 字段传递
                                if (delta?.reasoning_content) {
                                    const thought = delta.reasoning_content;
                                    fullThought += thought;
                                    sendEvent({ type: 'thought', content: thought });
                                }

                                // 最终答案通过 content 字段传递
                                if (delta?.content) {
                                    const text = delta.content;
                                    fullText += text;
                                    sendEvent({ type: 'text', content: text });
                                }
                            } catch { }
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    // 存储 AI 回复到数据库
                    if (user && currentConversationId) {
                        const writeCondition = writePermitTime
                            ? { _id: currentConversationId, userId: user.userId, updatedAt: { $lte: new Date(writePermitTime) } }
                            : { _id: currentConversationId, userId: user.userId };
                        const modelMessage = {
                            id: modelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }]
                        };
                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            {
                                $push: {
                                    messages: modelMessage
                                },
                                updatedAt: Date.now()
                            }
                        );
                    }
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }
                    try {
                        const errorPayload = JSON.stringify({ type: 'stream_error', message: err?.message || 'Unknown error' });
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    } catch {
                        controller.error(err);
                    }
                } finally {
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    try {
                        req?.signal?.removeEventListener?.('abort', onAbort);
                    } catch { }
                }
            }
        });

        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        };
        if (currentConversationId) {
            headers['X-Conversation-Id'] = currentConversationId;
        }
        return new Response(responseStream, { headers });

    } catch (error) {
        console.error('DeepSeek API Error:', {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const isUpstreamAuthError = rawStatus === 401;
        const status = isUpstreamAuthError ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (isUpstreamAuthError) {
            errorMessage = '模型服务认证失败，请检查接口配置';
        } else if (error?.message?.includes('API_KEY')) {
            errorMessage = 'API configuration error. Please check your API keys.';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
