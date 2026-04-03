import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import {
    fetchImageAsBase64,
    generateMessageId,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
    estimateTokens,
    getStoredPartsFromMessage
} from '@/app/api/chat/utils';
import { DEEPSEEK_CHAT_MODEL, DEEPSEEK_REASONER_MODEL, toZenmuxModel } from '@/lib/shared/models';
import { resolveDeepSeekProviderConfig } from '@/lib/modelRoutes';
import { buildDirectChatSystemPrompt } from '@/lib/server/chat/systemPromptBuilder';
import {
    clampMaxTokens,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import {
    CONVERSATION_WRITE_CONFLICT_ERROR,
    buildConversationWriteCondition,
    loadConversationForRoute,
    rollbackConversationTurn,
} from '@/app/api/chat/conversationState';
import {
    enrichConversationPartsWithBlobIds,
    enrichStoredMessagesWithBlobIds,
} from '@/lib/server/conversations/blobReferences';
import {
    createWebBrowsingRuntime,
    executeWebBrowsingNativeToolCall,
    getDeepSeekWebTools,
    WEB_BROWSING_MAX_ROUNDS,
} from '@/lib/server/webBrowsing/nativeTools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

/**
 * 将存储的历史消息转换为 DeepSeek（OpenAI兼容）格式
 * DeepSeek 使用标准 OpenAI Chat Completions 消息格式：
 * { role: "user"|"assistant", content: "..." }
 * 
 * 关键：多轮对话中只传递 content，不传递 reasoning
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

        const { baseUrl: deepseekBaseUrl, apiKey } = resolveDeepSeekProviderConfig();
        const rawApiModel = model === DEEPSEEK_REASONER_MODEL ? DEEPSEEK_REASONER_MODEL : DEEPSEEK_CHAT_MODEL;
        const apiModel = toZenmuxModel(rawApiModel);

        let currentConversationId = conversationId;
        let currentConversation = await loadConversationForRoute({
            conversationId: currentConversationId,
            userId: user.userId,
            expectedProvider: 'deepseek',
        });
        let createdConversationForRequest = false;
        let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
        let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();

        let deepseekMessages = [];
        let effectiveHistoryMessages = [];
        const limit = Number.parseInt(historyLimit, 10);
        if (!Number.isFinite(limit) || limit < 0) {
            return Response.json({ error: 'historyLimit invalid' }, { status: 400 });
        }
        const isRegenerateMode = mode === 'regenerate' && user && currentConversationId && Array.isArray(messages);
        let storedMessagesForRegenerate = null;
        const resolvedUserMessageId = (typeof userMessageId === 'string' && userMessageId.trim())
            ? userMessageId.trim()
            : generateMessageId();
        const resolvedModelMessageId = (typeof modelMessageId === 'string' && modelMessageId.trim())
            ? modelMessageId.trim()
            : generateMessageId();

        if (isRegenerateMode) {
            let sanitized;
            try {
                sanitized = sanitizeStoredMessagesStrict(messages);
            } catch (e) {
                return Response.json({ error: e?.message || 'messages invalid' }, { status: 400 });
            }
            sanitized = await enrichStoredMessagesWithBlobIds(sanitized, { userId: user.userId });
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
            deepseekMessages = await buildDeepSeekMessagesFromHistory(effectiveMsgs);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? safeHistory.slice(-limit) : safeHistory;
            effectiveHistoryMessages = effectiveHistory;
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

        let maxTokens;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }

        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);

        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? `${prompt.substring(0, 30)}...` : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title,
                model,
                settings: {
                    ...(settings && typeof settings === 'object' ? settings : {}),
                    webSearch: parseWebSearchConfig(config?.webSearch),
                },
                messages: []
            });
            currentConversationId = newConv._id.toString();
            currentConversation = newConv.toObject();
            createdConversationForRequest = true;
            previousMessages = [];
            previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
        }

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

            const enrichedStoredUserParts = await enrichConversationPartsWithBlobIds(storedUserParts, {
                userId: user.userId,
            });
            const userMsgTime = Date.now();
            const userMessage = {
                id: resolvedUserMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: enrichedStoredUserParts
            };
            const updatedConv = await Conversation.findOneAndUpdate({ _id: currentConversationId, userId: user.userId }, {
                $push: {
                    messages: userMessage
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            if (!updatedConv) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }
            writePermitTime = updatedConv.updatedAt?.getTime?.() ?? userMsgTime;
        }

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
                let finalMessagePersisted = false;

                const rollbackCurrentTurn = async () => {
                    if (finalMessagePersisted) return;
                    await rollbackConversationTurn({
                        conversationId: currentConversationId,
                        userId: user.userId,
                        createdConversationForRequest,
                        isRegenerateMode,
                        previousMessages,
                        previousUpdatedAt,
                        userMessageId: resolvedUserMessageId,
                        writePermitTime,
                    });
                };

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

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url) continue;
                            if (!citations.some((c) => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title });
                            }
                        }
                    };
                    const finalSystemPrompt = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const finalMessages = [
                        { role: 'system', content: finalSystemPrompt },
                        ...deepseekMessages
                    ];
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const toolRecords = [];

                    if (enableWebSearch) {
                        const loopMessages = [...finalMessages];
                        let finished = false;

                        for (let round = 0; round < WEB_BROWSING_MAX_ROUNDS; round += 1) {
                            const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`
                                },
                                body: JSON.stringify({
                                    model: apiModel,
                                    messages: loopMessages,
                                    stream: true,
                                    max_tokens: clampMaxTokens(maxTokens, 65536),
                                    tools: getDeepSeekWebTools(),
                                })
                            });

                            if (!response.ok) {
                                const errorText = await response.text();
                                throw new Error(`DeepSeek API Error: ${response.status} ${errorText}`);
                            }

                            const reader = response.body.getReader();
                            const decoder = new TextDecoder();
                            let buffer = '';
                            let thought = '';
                            let content = '';
                            let toolCalls = [];
                            const toolCallsMap = new Map();

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
                                        if (delta?.reasoning) {
                                            thought += delta.reasoning;
                                            sendEvent({ type: 'thought', content: delta.reasoning });
                                        }
                                        if (delta?.content) {
                                            content += delta.content;
                                            sendEvent({ type: 'text', content: delta.content });
                                        }
                                        if (Array.isArray(delta?.tool_calls)) {
                                            for (const tc of delta.tool_calls) {
                                                const idx = tc.index;
                                                if (!toolCallsMap.has(idx)) {
                                                    toolCallsMap.set(idx, { id: tc.id || '', function: { name: '', arguments: '' } });
                                                }
                                                const existing = toolCallsMap.get(idx);
                                                if (tc.id) existing.id = tc.id;
                                                if (tc.function?.name) existing.function.name += tc.function.name;
                                                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                                            }
                                        }
                                    } catch { }
                                }
                            }

                            if (thought) {
                                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            }

                            toolCalls = Array.from(toolCallsMap.values())
                                .filter((item) => item.function?.name)
                                .map((item) => ({
                                    id: item.id,
                                    type: 'function',
                                    function: item.function,
                                }));

                            if (toolCalls.length === 0) {
                                fullText = content;
                                finished = true;
                                break;
                            }

                            loopMessages.push({
                                role: 'assistant',
                                content: content || '',
                                ...(thought ? { reasoning: thought } : {}),
                                tool_calls: toolCalls,
                            });

                            for (const toolCall of toolCalls) {
                                const toolExecution = await executeWebBrowsingNativeToolCall({
                                    apiName: toolCall?.function?.name,
                                    argumentsInput: toolCall?.function?.arguments,
                                    runtime,
                                    sendEvent,
                                    pushCitations,
                                    round: round + 1,
                                    signal: req?.signal,
                                });
                                toolRecords.push(toolExecution.toolRecord);
                                loopMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: toolExecution.outputText,
                                });
                            }
                        }

                        if (!finished && !clientAborted) {
                            throw new Error('DeepSeek 工具循环未返回最终答案');
                        }
                    } else {
                        const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({
                                model: apiModel,
                                messages: finalMessages,
                                stream: true,
                                max_tokens: clampMaxTokens(maxTokens, 65536),
                            })
                        });

                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`DeepSeek API Error: ${response.status} ${errorText}`);
                        }

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
                                    if (delta?.reasoning) {
                                        const thought = delta.reasoning;
                                        fullThought += thought;
                                        sendEvent({ type: 'thought', content: thought });
                                    }
                                    if (delta?.content) {
                                        const text = delta.content;
                                        fullText += text;
                                        sendEvent({ type: 'text', content: text });
                                    }
                                } catch { }
                            }
                        }
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
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
                        const modelMessage = {
                            id: resolvedModelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            tools: enableWebSearch && toolRecords.length > 0 ? toolRecords : null,
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }]
                        };
                        const persistedConversation = await Conversation.findOneAndUpdate(
                            buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                            {
                                $push: {
                                    messages: modelMessage
                                },
                                updatedAt: Date.now()
                            },
                            { new: true }
                        ).select('updatedAt');
                        if (!persistedConversation) {
                            const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
                            conflictError.status = 409;
                            throw conflictError;
                        }
                        finalMessagePersisted = true;
                        writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();
                    }
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }
                    try { await rollbackCurrentTurn(); } catch { }
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
