import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptMessage, encryptMessages, encryptString } from '@/lib/encryption';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    sanitizeStoredMessages,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens
} from '@/app/api/chat/utils';
import { buildWebSearchGuide, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import { buildEconomySystemPrompt, isEconomyLineMode } from '@/app/lib/economyModels';

import { buildOpenAIInputFromHistory } from '@/app/api/openai/openaiHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ZENMUX_OPENAI_BASE_URL = 'https://zenmux.ai/api/v1';
const RIGHT_CODES_OPENAI_BASE_URL = 'https://www.right.codes/codex';
const ZENMUX_API_KEY = process.env.ZENMUX_API_KEY;
const RIGHT_CODES_API_KEY = process.env.RIGHT_CODES_API_KEY;
const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const DEFAULT_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
const MODEL_REASONING_EFFORTS = {};



export async function POST(req) {
    let writePermitTime = null;

    try {
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
            console.error("Database connection error:", dbError?.message);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        const isEconomyLine = isEconomyLineMode(config?.lineMode);
        const apiBaseUrl = isEconomyLine ? RIGHT_CODES_OPENAI_BASE_URL : ZENMUX_OPENAI_BASE_URL;
        const apiKey = isEconomyLine ? RIGHT_CODES_API_KEY : ZENMUX_API_KEY;
        if (!apiKey) {
            const missingKey = isEconomyLine ? 'RIGHT_CODES_API_KEY' : 'ZENMUX_API_KEY';
            return Response.json({ error: `${missingKey} is not set` }, { status: 500 });
        }
        const apiModel = model.startsWith('openai/') || model.includes('/') ? model : `openai/${model}`;
        const isSeedModel = typeof apiModel === 'string' && apiModel.startsWith('volcengine/doubao-seed');

        let currentConversationId = conversationId;

        // 创建新会话
        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: encryptString(title),
                model: model,
                settings: settings,
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        let openaiInput = [];
        const limit = Number.parseInt(historyLimit);
        const isRegenerateMode = mode === 'regenerate' && user && currentConversationId && Array.isArray(messages);
        let storedMessagesForRegenerate = null;

        if (isRegenerateMode) {
            const sanitized = sanitizeStoredMessages(messages);
            const regenerateTime = Date.now();
            const conv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                { $set: { messages: encryptMessages(sanitized), updatedAt: regenerateTime } },
                { new: true }
            ).select('messages updatedAt');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = sanitized;
            writePermitTime = conv.updatedAt?.getTime?.();
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            openaiInput = await buildOpenAIInputFromHistory(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            openaiInput = await buildOpenAIInputFromHistory(effectiveHistory);
        }

        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [{ type: 'input_text', text: prompt }];

            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'input_image',
                            image_url: `data:${mimeType};base64,${base64Data}`
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
            }

            openaiInput.push({ role: 'user', content: userContent });
        }

        // 保存用户消息
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
            const resolvedUserMessageId = userMessageId;
            const encryptedUserMessage = encryptMessage({
                id: resolvedUserMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: storedUserParts
            });
            const updatedConv = await Conversation.findOneAndUpdate({ _id: currentConversationId, userId: user.userId }, {
                $push: {
                    messages: encryptedUserMessage
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.();
        }

        // 构建 Responses API 请求
        const maxTokens = config?.maxTokens;
        const thinkingLevel = config?.thinkingLevel;
        const budgetTokens = Number.parseInt(config?.budgetTokens, 10);

        const userSystemPrompt = typeof config?.systemPrompt === 'string' ? config.systemPrompt : '';
        const baseSystemPrompt = injectCurrentTimeSystemReminder(
            isEconomyLine ? buildEconomySystemPrompt(userSystemPrompt) : userSystemPrompt
        );
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";
        const baseInputWithInstructions = [
            { role: 'developer', content: [{ type: 'input_text', text: baseSystemPrompt }] },
            ...(Array.isArray(openaiInput) ? openaiInput : [])
        ];

        const baseRequestBody = {
            model: apiModel,
            stream: true,
            max_output_tokens: maxTokens,
            reasoning: {
                effort: "high",
                summary: "auto"
            }
        };

        // Map UI thinkingLevel to Responses API reasoning.effort
        const allowedEfforts = MODEL_REASONING_EFFORTS[model] || DEFAULT_REASONING_EFFORTS;
        if (allowedEfforts.has(thinkingLevel)) {
            baseRequestBody.reasoning.effort = thinkingLevel;
        }

        if (isSeedModel) {
            baseRequestBody.extra_body = {
                thinking: {
                    type: 'enabled',
                    ...(Number.isFinite(budgetTokens) && budgetTokens > 0
                        ? { budget_tokens: budgetTokens }
                        : {})
                }
            };
        }

        // 是否启用联网搜索
        const enableWebSearch = config?.webSearch === true;
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch { /* ignore */ }

        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 15000;
        let heartbeatTimer = null;

        const normalizeChunkText = (value) => {
            if (typeof value === 'string') return value;
            if (!Array.isArray(value)) return '';
            return value.map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item.text === 'string') return item.text;
                return '';
            }).join('');
        };

        const normalizeChunkThought = (value) => {
            if (typeof value === 'string') return value;
            if (Array.isArray(value)) {
                return value.map((item) => {
                    if (typeof item === 'string') return item;
                    if (item && typeof item.text === 'string') return item.text;
                    if (item && typeof item.content === 'string') return item.content;
                    return '';
                }).join('');
            }
            if (value && typeof value === 'object') {
                if (typeof value.text === 'string') return value.text;
                if (typeof value.content === 'string') return value.content;
            }
            return '';
        };

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = "";
                let fullThought = "";
                let citations = [];
                let searchContextTokens = 0;

                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch { /* ignore */ }
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
                            if (!citations.some(c => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title });
                            }
                        }
                    };

                    const { searchContextText } = await runWebSearchOrchestration({
                        enableWebSearch,
                        prompt,
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        providerLabel: 'OpenAI',
                    });

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    const searchContextSection = searchContextText
                        ? buildWebSearchContextBlock(searchContextText)
                        : "";
                    if (searchContextSection) {
                        searchContextTokens = estimateTokens(searchContextSection);
                        sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                    }
                    const finalSystemPrompt = `${baseSystemPrompt}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`;
                    const finalInput = baseInputWithInstructions.slice();
                    finalInput[0] = { role: 'developer', content: [{ type: 'input_text', text: finalSystemPrompt }] };
                    const requestBody = {
                        ...baseRequestBody,
                        input: finalInput
                    };

                    const response = await fetch(`${apiBaseUrl}/responses`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`OpenAI API Error: ${response.status} ${errorText}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";

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

                                // 处理 Responses API 和 Chat Completions 事件
                                if (event.type === 'response.output_text.delta') {
                                    const text = event.delta;
                                    fullText += text;
                                    sendEvent({ type: 'text', content: text });
                                } else if (event.type === 'response.reasoning.delta' || event.type === 'response.reasoning_summary_text.delta') {
                                    const thought = event.delta;
                                    fullThought += thought;
                                    sendEvent({ type: 'thought', content: thought });
                                } else if (event.type === 'response.output_text.annotation.added') {
                                    // Web search 引用（url_citation）
                                    const ann = event.annotation;
                                    if (ann?.type === 'url_citation' && ann?.url) {
                                        const exists = citations.some(c => c?.url === ann.url);
                                        if (!exists) {
                                            citations.push({ url: ann.url, title: ann.title });
                                            sendEvent({ type: 'citations', citations });
                                        }
                                    }
                                } else if (Array.isArray(event?.choices)) {
                                    const choice = event.choices[0] || null;
                                    const delta = choice?.delta;

                                    const text = normalizeChunkText(delta?.content);
                                    if (text) {
                                        fullText += text;
                                        sendEvent({ type: 'text', content: text });
                                    }

                                    const thought = normalizeChunkThought(delta?.reasoning_content);
                                    if (thought) {
                                        fullThought += thought;
                                        sendEvent({ type: 'thought', content: thought });
                                    }
                                }
                            } catch { /* ignore parse errors */ }
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    // 发送引用信息
                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (user && currentConversationId) {
                        const writeCondition = writePermitTime
                            ? { _id: currentConversationId, userId: user.userId, updatedAt: { $lte: new Date(writePermitTime) } }
                            : { _id: currentConversationId, userId: user.userId };
                        const resolvedModelMessageId = modelMessageId;
                        const encryptedModelMessage = encryptMessage({
                            id: resolvedModelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }]
                        });
                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            {
                                $push: {
                                    messages: encryptedModelMessage
                                },
                                updatedAt: Date.now()
                            }
                        );
                    }
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }
                    // 将错误作为 SSE 事件发送给客户端（而非 controller.error），保留原始错误信息
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
                    } catch { /* ignore */ }
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
        console.error("OpenAI API Error:", {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code
        });

        const status = typeof error?.status === 'number' ? error.status : 500;
        let errorMessage = error?.message;

        if (error?.message?.includes('API_KEY')) {
            errorMessage = "API configuration error. Please check your API keys.";
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
