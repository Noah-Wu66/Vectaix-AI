import Anthropic from "@anthropic-ai/sdk";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { CLAUDE_OPUS_MODEL, CLAUDE_SONNET_MODEL } from '@/lib/shared/models';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessagesStrict,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens
} from '@/app/api/chat/utils';
import { buildWebSearchDecisionPrompts, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import { buildEconomySystemPrompt } from '@/lib/server/chat/economyModels';
import {
    WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
    buildWebSearchGuide,
    getWebSearchProviderRuntimeOptions,
} from '@/lib/server/chat/webSearchConfig';
import {
    clampMaxTokens,
    parseClaudeThinkingLevel,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import { getModelRoutes, resolveOpusProviderConfig } from '@/lib/modelRoutes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };

const MAX_REQUEST_BYTES = 2_000_000;

async function storedPartToClaudePart(part) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        return { type: 'text', text: part.text };
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType;
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Data
            }
        };
    }

    return null;
}

async function buildClaudeMessagesFromHistory(messages) {
    const claudeMessages = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;

        const content = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToClaudePart(storedPart);
            if (p) content.push(p);
        }
        if (content.length) {
            claudeMessages.push({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content
            });
        }
    }
    return claudeMessages;
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
            console.error("Database connection error:", dbError?.message);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        let currentConversationId = conversationId;

        const modelRoutes = await getModelRoutes();
        const { baseUrl: anthropicBaseUrl, apiKey } = resolveOpusProviderConfig(modelRoutes);
        const apiModel = model.startsWith(CLAUDE_OPUS_MODEL)
            ? CLAUDE_OPUS_MODEL
            : model.startsWith(CLAUDE_SONNET_MODEL)
                ? CLAUDE_SONNET_MODEL
                : model;
        const client = new Anthropic({
            apiKey,
            baseURL: anthropicBaseUrl,
        });

        // 创建新会话
        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: title,
                model: model,
                settings: {
                    ...(settings && typeof settings === 'object' ? settings : {}),
                    webSearch: parseWebSearchConfig(config?.webSearch),
                },
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        let claudeMessages = [];
        let effectiveHistoryMessages = [];
        const limit = Number.parseInt(historyLimit, 10);
        if (!Number.isFinite(limit) || limit < 0) {
            return Response.json({ error: 'historyLimit invalid' }, { status: 400 });
        }
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
            const historyBeforeCurrentPrompt = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === 'user'
                ? msgs.slice(0, -1)
                : msgs;
            effectiveHistoryMessages = (limit > 0 && Number.isFinite(limit))
                ? historyBeforeCurrentPrompt.slice(-limit)
                : historyBeforeCurrentPrompt;
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveMsgs);
        } else {
            // 非 regenerate 模式：历史消息也需要正确处理图片
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistoryMessages = effectiveHistory;
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveHistory);
        }

        // 在历史消息的最后一条添加缓存控制，使对话历史可被缓存
        if (claudeMessages.length > 0) {
            const lastHistoryMsg = claudeMessages[claudeMessages.length - 1];
            if (lastHistoryMsg.content?.length > 0) {
                const lastContent = lastHistoryMsg.content[lastHistoryMsg.content.length - 1];
                lastContent.cache_control = { type: "ephemeral", ttl: "1h" };
            }
        }

        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [{ type: 'text', text: prompt }];

            // 支持多张图片
            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64Data
                            }
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
            }

            claudeMessages.push({ role: 'user', content: userContent });
        }

        // 保存用户消息
        if (user && !isRegenerateMode) {
            const storedUserParts = [];
            if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });

            // 支持多张图片存储
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
            const userMessage = {
                id: resolvedUserMessageId,
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

        // 构建请求参数（联网搜索上下文将在流式开始前注入）
        let maxTokens;
        let thinkingLevel;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
            thinkingLevel = parseClaudeThinkingLevel(config?.thinkingLevel);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }
        const isClaudeAdaptiveThinkingModel = typeof model === "string"
            && (model.startsWith(CLAUDE_OPUS_MODEL) || model.startsWith(CLAUDE_SONNET_MODEL));
        if (!isClaudeAdaptiveThinkingModel) {
            return Response.json({ error: 'unsupported Claude model' }, { status: 400 });
        }
        const maxTokenCap = typeof model === "string" && model.startsWith(CLAUDE_OPUS_MODEL) ? 128000 : 64000;
        const normalizedMaxTokens = clampMaxTokens(maxTokens, maxTokenCap);
        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const baseSystemPrompt = await injectCurrentTimeSystemReminder(buildEconomySystemPrompt(userSystemPrompt));
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        // 是否启用联网搜索
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

        // 启用联网搜索时禁用来源括号标注
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);
        const runClaudeDecision = async ({ prompt: decisionPrompt, historyMessages, searchRounds }) => {
            const { systemText, userText } = await buildWebSearchDecisionPrompts({
                prompt: decisionPrompt,
                historyMessages,
                searchRounds,
            });

            const response = await client.messages.create({
                model: apiModel,
                max_tokens: WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
                system: systemText,
                messages: [
                    {
                        role: 'user',
                        content: [{ type: 'text', text: userText }]
                    }
                ]
            });

            const text = Array.isArray(response?.content)
                ? response.content
                    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
                    .join('')
                    .trim()
                : '';

            if (!text) {
                throw new Error('联网判断未返回有效内容');
            }

            return text;
        };

        const claudeWebSearchRuntime = getWebSearchProviderRuntimeOptions('claude');

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
                    const sendSearchError = (message, details = {}) => {
                        if (searchErrorSent) return;
                        searchErrorSent = true;
                        sendEvent({ type: 'search_error', message, ...details });
                    };

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url) continue;
                            if (!citations.some(c => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title, cited_text: null });
                            }
                        }
                    };

                    const { searchContextText } = await runWebSearchOrchestration({
                        enableWebSearch,
                        webSearchOptions: webSearchConfig,
                        prompt,
                        historyMessages: effectiveHistoryMessages,
                        decisionRunner: runClaudeDecision,
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        model,
                        conversationId: currentConversationId,
                        logDecision: true,
                        ...claudeWebSearchRuntime,
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
                    const systemPrompt = `${baseSystemPrompt}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`;
                    const requestParams = {
                        model: apiModel,
                        max_tokens: normalizedMaxTokens,
                        system: [
                            {
                                type: "text",
                                text: systemPrompt,
                                cache_control: {
                                    type: "ephemeral",
                                    ttl: "1h"
                                }
                            }
                        ],
                        messages: claudeMessages,
                        stream: true,
                        thinking: { type: "adaptive" },
                        output_config: {
                            effort: thinkingLevel
                        }
                    };

                    const stream = await client.messages.stream(requestParams);

                    for await (const event of stream) {
                        if (clientAborted) break;

                        if (event.type === 'content_block_delta') {
                            const delta = event.delta;
                            if (delta.type === 'thinking_delta') {
                                fullThought += delta.thinking;
                                sendEvent({ type: 'thought', content: delta.thinking });
                            } else if (delta.type === 'text_delta') {
                                fullText += delta.text;
                                sendEvent({ type: 'text', content: delta.text });
                            }
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
                        const resolvedModelMessageId = (isNonEmptyString(modelMessageId) && modelMessageId.length <= 128)
                            ? modelMessageId
                            : generateMessageId();
                        const modelMessage = {
                            id: resolvedModelMessageId,
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
        console.error("Claude API Error:", {
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
            errorMessage = "API configuration error. Please check your API keys.";
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
