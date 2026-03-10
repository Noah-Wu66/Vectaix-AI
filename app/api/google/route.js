import { GoogleGenAI } from "@google/genai";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
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
import { buildWebSearchDecisionPrompts, buildWebSearchGuide, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from '@/app/lib/geminiModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_DECISION_MODEL = GEMINI_FLASH_MODEL;
const GEMINI_DECISION_THINKING_LEVEL = 'MINIMAL';
const MAX_REQUEST_BYTES = 2_000_000;

async function storedPartToRequestPart(part) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        const p = { text: part.text };
        if (isNonEmptyString(part.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
        return p;
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType || fetchedMimeType;
        const p = { inlineData: { mimeType, data: base64Data } };
        if (isNonEmptyString(part.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
        return p;
    }

    return null;
}

async function buildGeminiContentsFromMessages(messages) {
    const contents = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;
        const parts = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToRequestPart(storedPart);
            if (p) parts.push(p);
        }
        if (parts.length) contents.push({ role: msg.role, parts });
    }
    return contents;
}

function resolveGeminiApiModel(model) {
    const normalizedModel = typeof model === 'string' ? model.trim() : '';
    const modelWithoutProvider = normalizedModel.startsWith('google/')
        ? normalizedModel.slice('google/'.length)
        : normalizedModel;

    if (
        modelWithoutProvider === GEMINI_PRO_MODEL
    ) {
        return GEMINI_PRO_MODEL;
    }

    if (
        modelWithoutProvider === GEMINI_FLASH_MODEL
    ) {
        return GEMINI_FLASH_MODEL;
    }

    return GEMINI_FLASH_MODEL;
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
            return Response.json(
                { error: 'Invalid JSON in request body' },
                { status: 400 }
            );
        }

        const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

        if (!model || typeof model !== 'string') {
            return Response.json(
                { error: 'Model is required and must be a string' },
                { status: 400 }
            );
        }

        if (!prompt || typeof prompt !== 'string') {
            return Response.json(
                { error: 'Prompt is required and must be a string' },
                { status: 400 }
            );
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
            return Response.json(
                { error: 'Database connection failed' },
                { status: 500 }
            );
        }

        let currentConversationId = conversationId;

        if (!GEMINI_API_KEY) {
            return Response.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 });
        }
        const apiModel = resolveGeminiApiModel(model);
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: title,
                model: model,
                settings: settings,
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        let contents = [];
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
            contents = await buildGeminiContentsFromMessages(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'model') {
                    const hasImage = Array.isArray(msg.parts) && msg.parts.some((p) => typeof p?.inlineData?.url === 'string' && p.inlineData.url);
                    contents.push({
                        role: msg.role,
                        parts: [{ text: `${msg.content} ${hasImage ? '[Image sent previously]' : ''}` }]
                    });
                }
            });
        }

        let currentParts = isRegenerateMode ? null : [{ text: prompt }];
        let dbImageEntries = [];

        if (!isRegenerateMode && config?.images?.length > 0) {
            for (const img of config.images) {
                if (img?.url) {
                    const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                    currentParts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        },
                        ...(config.mediaResolution ? { mediaResolution: { level: config.mediaResolution } } : {})
                    });
                    dbImageEntries.push({ url: img.url, mimeType });
                }
            }
        }

        if (!isRegenerateMode) {
            contents.push({
                role: "user",
                parts: currentParts
            });
        }

        const userSystemPrompt = typeof config?.systemPrompt === 'string' ? config.systemPrompt : '';
        const baseSystemText = await injectCurrentTimeSystemReminder(userSystemPrompt);
        const generationConfig = (config?.generationConfig && typeof config.generationConfig === 'object' && !Array.isArray(config.generationConfig))
            ? config.generationConfig
            : {};
        const safeGenerationConfig = { ...generationConfig };
        delete safeGenerationConfig.temperature;
        const maxTokens = Number.parseInt(config?.maxTokens, 10);
        if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
            return Response.json({ error: 'maxTokens invalid' }, { status: 400 });
        }

        const rawThinkingLevel = typeof config?.thinkingLevel === 'string' ? config.thinkingLevel.trim() : '';
        const thinkingLevel = rawThinkingLevel.toUpperCase();
        const flashAllowedLevels = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
        const proAllowedLevels = new Set(['LOW', 'MEDIUM', 'HIGH']);
        const isAllowedThinkingLevel = apiModel === GEMINI_FLASH_MODEL
            ? flashAllowedLevels.has(thinkingLevel)
            : proAllowedLevels.has(thinkingLevel);
        if (!isAllowedThinkingLevel) {
            return Response.json({ error: 'thinkingLevel invalid' }, { status: 400 });
        }

        const baseConfig = {
            systemInstruction: {
                parts: [{ text: baseSystemText }]
            },
            ...safeGenerationConfig,
            temperature: 1.0,
            maxOutputTokens: maxTokens,
            thinkingConfig: {
                thinkingLevel,
                includeThoughts: true
            }
        };

        const enableWebSearch = config?.webSearch === true;
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);
        const extractGeminiDecisionText = (result) => {
            const parts = Array.isArray(result?.candidates?.[0]?.content?.parts)
                ? result.candidates[0].content.parts
                : [];

            return parts
                .filter((part) => !part?.thought && typeof part?.text === 'string')
                .map((part) => part.text)
                .join('')
                .trim();
        };

        const runGeminiDecision = async ({ prompt: decisionPrompt, historyMessages, searchRounds }) => {
            const { systemText, userText } = await buildWebSearchDecisionPrompts({
                prompt: decisionPrompt,
                historyMessages,
                searchRounds,
            });

            const result = await ai.models.generateContent({
                model: GEMINI_DECISION_MODEL,
                contents: [{
                    role: 'user',
                    parts: [{ text: userText }]
                }],
                config: {
                    systemInstruction: {
                        parts: [{ text: systemText }]
                    },
                    maxOutputTokens: 200,
                    temperature: 0.1,
                    thinkingConfig: {
                        thinkingLevel: GEMINI_DECISION_THINKING_LEVEL,
                        includeThoughts: false
                    }
                }
            });

            const text = extractGeminiDecisionText(result);
            if (!text) {
                throw new Error('联网判断未返回有效内容');
            }

            return text;
        };
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

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

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch {
            // ignore
        }

        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 15000;
        let heartbeatTimer = null;

        const stream = new ReadableStream({
            async start(controller) {
                let fullText = "";
                let fullThought = "";
                let citations = [];
                let searchContextTokens = 0;
                const seenUrls = new Set();
                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch {
                            // ignore
                        }
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
                            if (!item?.url || seenUrls.has(item.url)) continue;
                            seenUrls.add(item.url);
                            citations.push({ url: item.url, title: item.title });
                        }
                    };

                    const { searchContextText } = await runWebSearchOrchestration({
                        enableWebSearch,
                        prompt,
                        historyMessages: history,
                        decisionRunner: runGeminiDecision,
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        providerLabel: 'Gemini',
                        model,
                        conversationId: currentConversationId,
                        warnOnNoContext: true,
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

                    const finalSystemPrompt = `${baseSystemText}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`;
                    const finalConfig = {
                        ...baseConfig,
                        systemInstruction: {
                            parts: [{ text: finalSystemPrompt }]
                        }
                    };

                    const streamResult = await ai.models.generateContentStream({
                        model: apiModel,
                        contents: contents,
                        config: finalConfig
                    });

                    for await (const chunk of streamResult) {
                        if (clientAborted) break;

                        const candidate = Array.isArray(chunk?.candidates)
                            ? chunk.candidates[0]
                            : null;
                        const parts = Array.isArray(candidate?.content?.parts)
                            ? candidate.content.parts
                            : [];

                        if (parts.length === 0) continue;

                        for (const part of parts) {
                            if (clientAborted) break;
                            if (!part || typeof part !== 'object') continue;

                            const text = typeof part.text === 'string' ? part.text : '';
                            if (!text) continue;

                            if (part.thought) {
                                fullThought += text;
                                sendEvent({ type: 'thought', content: text });
                            } else {
                                fullText += text;
                                sendEvent({ type: 'text', content: text });
                            }
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    if (citations.length > 0) {
                        sendEvent({ type: 'citations', citations });
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
                    } catch {
                        // ignore
                    }
                }
            }
        });

        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        };
        if (currentConversationId) { headers['X-Conversation-Id'] = currentConversationId; }
        return new Response(stream, { headers });

    } catch (error) {
        console.error("Gemini API Error:", {
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
        } else if (error?.message?.includes('ECONNREFUSED')) {
            errorMessage = "Failed to connect to external service.";
        } else if (error?.message?.includes('fetch')) {
            errorMessage = "Failed to fetch external resource.";
        }

        return Response.json(
            {
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
            },
            { status }
        );
    }
}
