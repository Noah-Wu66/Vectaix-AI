import { GoogleGenAI } from "@google/genai";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptMessage, encryptMessages, encryptString } from '@/lib/encryption';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessages,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens
} from '@/app/api/chat/utils';
import { buildWebSearchGuide, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import { buildEconomySystemPrompt, isEconomyLineMode } from '@/app/lib/economyModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const ZENMUX_VERTEX_BASE_URL = 'https://zenmux.ai/api/vertex-ai';
const RIGHT_CODES_GEMINI_BASE_URL = 'https://www.right.codes/gemini';

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
        const mimeType = part.inlineData?.mimeType;
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

export async function POST(req) {
    // 写入许可时间戳：只有当 conversation.updatedAt <= 此值时，才允许写入 model 消息
    // 用于防止"停止后再 regenerate"时，旧请求晚于新请求覆盖导致重复回答
    let writePermitTime = null;

    try {
        // Validate request body
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

        // Validate required fields
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

        // 默认走 zenmux；经济线路走 right.codes
        const isEconomyLine = isEconomyLineMode(config?.lineMode);
        const apiModel = model === 'gemini-3-pro-preview'
            ? 'google/gemini-3-pro-preview'
            : 'google/gemini-3-flash-preview';
        const ai = new GoogleGenAI({
            apiKey: process.env.ZENMUX_API_KEY,
            httpOptions: {
                apiVersion: 'v1',
                baseUrl: isEconomyLine ? RIGHT_CODES_GEMINI_BASE_URL : ZENMUX_VERTEX_BASE_URL
            }
        });

        // 1) Ensure Conversation exists (for logged-in users)
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

        // 2) Prepare Request Contents
        let contents = [];
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
            // 记录写入许可时间：只有 updatedAt 仍为此值时才允许写入 model 消息
            writePermitTime = conv.updatedAt?.getTime?.();
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            // 使用 buildGeminiContentsFromMessages 正确处理图片消息
            contents = await buildGeminiContentsFromMessages(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'model') {
                    const hasImage = Array.isArray(msg.parts) && msg.parts.some((p) => typeof p?.inlineData?.url === 'string' && p.inlineData.url);
                    // History remains text-only fallback to save bandwidth
                    contents.push({
                        role: msg.role,
                        parts: [{ text: `${msg.content} ${hasImage ? '[Image sent previously]' : ''}` }]
                    });
                }
            });
        }

        // regenerate 模式：最后一条用户消息已经在 messages 里了，这里不再追加"新用户消息"
        let currentParts = isRegenerateMode ? null : [{ text: prompt }];

        // Handle Image Input (URL from Blob) - 支持多张图片
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

        // 2. Prepare Payload
        const userSystemPrompt = typeof config?.systemPrompt === 'string' ? config.systemPrompt : '';
        const baseSystemText = injectCurrentTimeSystemReminder(
            isEconomyLine ? buildEconomySystemPrompt(userSystemPrompt) : userSystemPrompt
        );
        const baseConfig = {
            systemInstruction: {
                parts: [{ text: baseSystemText }]
            },
            ...config?.generationConfig
        };

        if (config?.maxTokens) {
            baseConfig.maxOutputTokens = config.maxTokens;
        }

        if (config?.thinkingLevel) {
            baseConfig.thinkingConfig = {
                thinkingLevel: config.thinkingLevel,
                includeThoughts: true
            };
        }

        const enableWebSearch = config?.webSearch === true;
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);

        // 3. Database Logic
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
            // 记录写入许可时间
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
                    const sendSearchError = (message) => {
                        if (searchErrorSent) return;
                        searchErrorSent = true;
                        sendEvent({ type: 'search_error', message });
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
                        sendEvent,
                        pushCitations,
                        sendSearchError,
                        isClientAborted: () => clientAborted,
                        providerLabel: 'Gemini',
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
                    const finalSystemText = `${baseSystemText}${webSearchGuide}${searchContextSection}`;
                    const finalConfig = {
                        ...baseConfig,
                        systemInstruction: { parts: [{ text: finalSystemText }] }
                    };

                    const streamResult = await ai.models.generateContentStream({
                        model: apiModel,
                        contents: contents,
                        config: finalConfig
                    });

                    for await (const chunk of streamResult) {
                        if (clientAborted) break;
                        const candidate = chunk.candidates?.[0];
                        const parts = candidate?.content?.parts;

                        for (const part of parts) {
                            if (clientAborted) break;
                            if (part.thought && part.text) {
                                fullThought += part.text;
                                sendEvent({ type: 'thought', content: part.text });
                            } else if (part.text) {
                                fullText += part.text;
                                sendEvent({ type: 'text', content: part.text });
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
            'X-Accel-Buffering': 'no', // 禁用 nginx/反向代理缓冲
        };
        if (currentConversationId) { headers['X-Conversation-Id'] = currentConversationId; }
        return new Response(stream, { headers });

    } catch (error) {
        // Log detailed error information
        console.error("Gemini API Error:", {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code
        });

        const status = typeof error?.status === 'number' ? error.status : 500;

        // Provide user-friendly error messages
        let errorMessage = error?.message;

        // Add context for common errors
        if (error?.message?.includes('API_KEY')) {
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
