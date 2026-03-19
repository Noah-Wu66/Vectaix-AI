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
    estimateTokens
} from '@/app/api/chat/utils';
import { buildWebSearchDecisionPrompts, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import {
    WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
    buildWebSearchGuide,
    getWebSearchProviderRuntimeOptions,
} from '@/lib/server/chat/webSearchConfig';
import {
    parseMaxTokens,
    parseOpenAIThinkingLevel,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import { buildEconomySystemPrompt } from '@/lib/server/chat/economyModels';
import { getModelRoutes, resolveOpenAIProviderConfig } from '@/lib/modelRoutes';

import { buildOpenAIInputFromHistory } from '@/app/api/openai/openaiHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;
const DEFAULT_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
const MODEL_REASONING_EFFORTS = {};
const REASONING_SUMMARY_MODELS = new Set(['gpt-5.4']);

function extractUpstreamErrorMessage(status, rawText) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    const lower = text.toLowerCase();

    if (status === 502 || lower.includes('bad gateway')) {
        return 'OpenAI 网关暂时不可用（502），请稍后重试';
    }
    if (status === 503 || lower.includes('service unavailable')) {
        return 'OpenAI 服务暂时不可用（503），请稍后重试';
    }
    if (status === 504 || lower.includes('gateway timeout')) {
        return 'OpenAI 网关超时（504），请稍后重试';
    }

    try {
        const parsed = JSON.parse(text);
        const message = parsed?.error?.message || parsed?.message;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
    } catch {
        // ignore
    }

    if (text.startsWith('<!DOCTYPE html') || text.startsWith('<html')) {
        return `OpenAI 请求失败（${status}）`;
    }

    const compact = text.length > 600 ? `${text.slice(0, 600)}...` : text;
    return compact || `OpenAI 请求失败（${status}）`;
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

        const modelRoutes = await getModelRoutes();
        const { baseUrl: apiBaseUrl, apiKey } = resolveOpenAIProviderConfig(modelRoutes);
        const apiModel = model;

        let currentConversationId = conversationId;

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

        let openaiInput = [];
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
            openaiInput = await buildOpenAIInputFromHistory(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistoryMessages = effectiveHistory;
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

        // 构建 Responses API 请求
        let maxTokens;
        let thinkingLevel;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
            thinkingLevel = parseOpenAIThinkingLevel(config?.thinkingLevel);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }
        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const baseSystemPrompt = await injectCurrentTimeSystemReminder(buildEconomySystemPrompt(userSystemPrompt));
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";
        const baseInput = Array.isArray(openaiInput) ? openaiInput : [];

        const allowedEfforts = MODEL_REASONING_EFFORTS[model] || DEFAULT_REASONING_EFFORTS;
        if (!allowedEfforts.has(thinkingLevel)) {
            return Response.json({ error: 'thinkingLevel invalid' }, { status: 400 });
        }
        const reasoningConfig = {
            effort: thinkingLevel
        };
        if (REASONING_SUMMARY_MODELS.has(model)) {
            reasoningConfig.summary = 'auto';
        }
        const baseRequestBody = {
            model: apiModel,
            stream: true,
            max_output_tokens: maxTokens,
            instructions: baseSystemPrompt,
            input: baseInput,
            reasoning: reasoningConfig
        };

        // 是否启用联网搜索
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);
        const normalizeDecisionText = (value) => {
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

        const extractDecisionOutputFromResponses = (payload) => {
            if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
                return payload.output_text.trim();
            }

            const outputs = Array.isArray(payload?.output) ? payload.output : [];
            return outputs
                .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
                .map((item) => normalizeDecisionText(item?.text ?? item))
                .join('')
                .trim();
        };

        const extractJsonEventsFromSseText = (rawText) => {
            if (typeof rawText !== 'string' || !rawText.trim()) return [];

            const blocks = rawText.split(/\r?\n\r?\n/);
            const events = [];

            for (const block of blocks) {
                const trimmedBlock = block.trim();
                if (!trimmedBlock) continue;

                const lines = trimmedBlock.split(/\r?\n/);
                const dataLines = [];
                for (const line of lines) {
                    if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
                    if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).replace(/^\s*/, ''));
                    }
                }

                if (!dataLines.length) continue;

                const dataStr = dataLines.join('\n').trim();
                if (!dataStr || dataStr === '[DONE]') continue;

                try {
                    events.push(JSON.parse(dataStr));
                } catch {
                    // ignore invalid SSE chunks
                }
            }

            return events;
        };

        const extractDecisionTextFromSse = (rawText) => {
            const events = extractJsonEventsFromSseText(rawText);
            if (!events.length) return '';

            let outputText = '';

            for (const event of events) {
                if (typeof event?.output_text === 'string' && event.output_text.trim()) {
                    outputText += event.output_text;
                    continue;
                }

                if (event?.response) {
                    const completedText = extractDecisionOutputFromResponses(event.response);
                    if (completedText) {
                        outputText = completedText;
                    }
                }

                if (event.type === 'output.text.delta' || event.type === 'response.output_text.delta') {
                    const deltaText = typeof event?.delta === 'string'
                        ? event.delta
                        : (typeof event?.text === 'string'
                            ? event.text
                            : (typeof event?.data?.text === 'string' ? event.data.text : ''));
                    if (deltaText) outputText += deltaText;
                    continue;
                }

                if (Array.isArray(event?.choices)) {
                    const choice = event.choices[0] || null;
                    const delta = choice?.delta;
                    const text = typeof delta?.content === 'string'
                        ? delta.content
                        : normalizeDecisionText(delta?.content);
                    if (text) outputText += text;
                }
            }

            return outputText.trim();
        };

        const readDecisionResponseText = async (response) => {
            const rawText = await response.text();
            const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
            if (!trimmed) return '';

            try {
                const payload = JSON.parse(trimmed);
                return extractDecisionOutputFromResponses(payload);
            } catch {
                const sseText = extractDecisionTextFromSse(trimmed);
                if (sseText) return sseText;
                throw new Error(`联网判断返回格式无法解析：${trimmed.slice(0, 120)}`);
            }
        };

        const runOpenAIDecision = async ({ prompt: decisionPrompt, historyMessages, searchRounds }) => {
            const { systemText, userText } = await buildWebSearchDecisionPrompts({
                prompt: decisionPrompt,
                historyMessages,
                searchRounds,
            });

            const requestBody = {
                model: apiModel,
                stream: false,
                max_output_tokens: WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
                instructions: systemText,
                input: [
                    {
                        role: 'user',
                        content: [{ type: 'input_text', text: userText }]
                    }
                ],
            };

            const requestDecision = async () => fetch(`${apiBaseUrl}/responses`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            let response = await requestDecision();
            if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                await new Promise((resolve) => setTimeout(resolve, 800));
                response = await requestDecision();
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(extractUpstreamErrorMessage(response.status, errorText));
            }

            const text = await readDecisionResponseText(response);
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

        const normalizeEventDelta = (event) => {
            if (typeof event?.delta === 'string') return event.delta;
            if (typeof event?.text === 'string') return event.text;
            if (typeof event?.data?.text === 'string') return event.data.text;
            return '';
        };

        const openaiWebSearchRuntime = getWebSearchProviderRuntimeOptions('openai');

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
                                citations.push({ url: item.url, title: item.title });
                            }
                        }
                    };

                    const { searchContextText } = await runWebSearchOrchestration({
                        enableWebSearch,
                        webSearchOptions: webSearchConfig,
                        prompt,
                        historyMessages: effectiveHistoryMessages,
                        decisionRunner: runOpenAIDecision,
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        model,
                        conversationId: currentConversationId,
                        ...openaiWebSearchRuntime,
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
                    const requestBody = {
                        ...baseRequestBody,
                        instructions: finalSystemPrompt
                    };

                    const requestResponses = async () => fetch(`${apiBaseUrl}/responses`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    let response = await requestResponses();
                    if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                        await new Promise((resolve) => setTimeout(resolve, 800));
                        response = await requestResponses();
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        const message = extractUpstreamErrorMessage(response.status, errorText);
                        const upstreamError = new Error(message);
                        upstreamError.status = response.status;
                        throw upstreamError;
                    }

                    if (!response.body) {
                        const upstreamError = new Error('OpenAI 返回了空响应体，请稍后重试');
                        upstreamError.status = 502;
                        throw upstreamError;
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
                                if (event.type === 'output.text.delta' || event.type === 'response.output_text.delta') {
                                    const text = normalizeEventDelta(event);
                                    fullText += text;
                                    sendEvent({ type: 'text', content: text });
                                } else if (event.type === 'response.reasoning.delta' || event.type === 'response.reasoning_summary_text.delta') {
                                    const thought = normalizeEventDelta(event);
                                    fullThought += thought;
                                    sendEvent({ type: 'thought', content: thought });
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
        console.error("OpenAI API Error:", {
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
