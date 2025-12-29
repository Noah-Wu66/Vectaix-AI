import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchImageAsBase64(url) {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error("Failed to fetch image from blob");
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    return { base64Data, mimeType };
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function createHttpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function getStoredPartsFromMessage(msg) {
    if (Array.isArray(msg?.parts) && msg.parts.length > 0) return msg.parts;
    return null;
}

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
    for (const msg of messages || []) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts) {
            throw createHttpError(409, 'Outdated conversation: missing message parts');
        }
        const parts = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToRequestPart(storedPart);
            if (p) parts.push(p);
        }
        if (parts.length) contents.push({ role: msg.role, parts });
    }
    return contents;
}

function mimeTypeToExt(mimeType) {
    if (!isNonEmptyString(mimeType)) return 'png';
    return mimeType.split(';')[0].split('/')[1] || 'png';
}

function sanitizeStoredMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (msg.role !== 'user' && msg.role !== 'model') return null;
    const out = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
        type: typeof msg.type === 'string' ? msg.type : 'text',
    };
    if (isNonEmptyString(msg.image)) out.image = msg.image;
    if (isNonEmptyString(msg.mimeType)) out.mimeType = msg.mimeType;
    if (isNonEmptyString(msg.thought)) out.thought = msg.thought;
    if (Array.isArray(msg.parts) && msg.parts.length > 0) out.parts = msg.parts;
    return out;
}

function sanitizeStoredMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(sanitizeStoredMessage).filter(Boolean);
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
        } catch (jsonError) {
            console.error("Invalid JSON in request body:", jsonError);
            return Response.json(
                { error: 'Invalid JSON in request body' },
                { status: 400 }
            );
        }

        const { prompt, model, config, history = [], historyLimit = 0, conversationId, mode, messages } = body;

        // Validate required fields
        if (!model || typeof model !== 'string') {
            console.error("Missing or invalid model field");
            return Response.json(
                { error: 'Model is required and must be a string' },
                { status: 400 }
            );
        }

        if (!prompt || typeof prompt !== 'string') {
            console.error("Missing or invalid prompt field");
            return Response.json(
                { error: 'Prompt is required and must be a string' },
                { status: 400 }
            );
        }

        const auth = await getAuthPayload();
        let user = null;
        if (auth) {
            try {
                await dbConnect();
                const userDoc = await User.findById(auth.userId);
                if (userDoc) user = auth;
            } catch (dbError) {
                console.error("Database connection error:", dbError);
                return Response.json(
                    { error: 'Database connection failed' },
                    { status: 500 }
                );
            }
        }

        let currentConversationId = conversationId;

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // 1) Ensure Conversation exists (for logged-in users)
        if (user && !currentConversationId) {
            const title = (prompt || '').length > 30 ? (prompt || '').substring(0, 30) + '...' : (prompt || '');
            const newConv = await Conversation.create({
                userId: user.userId,
                title: title,
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
                { $set: { messages: sanitized, updatedAt: regenerateTime } },
                { new: true }
            ).select('messages updatedAt');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = conv.messages || [];
            // 记录写入许可时间：只有 updatedAt 仍为此值时才允许写入 model 消息
            writePermitTime = conv.updatedAt?.getTime?.() || regenerateTime;
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate || [];
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            effectiveMsgs.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'model') {
                    contents.push({
                        role: msg.role,
                        parts: [{ text: `${msg.content} ${msg.image ? '[Image sent previously]' : ''}` }]
                    });
                }
            });
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'model') {
                    // History remains text-only fallback to save bandwidth
                    contents.push({
                        role: msg.role,
                        parts: [{ text: `${msg.content} ${msg.image ? '[Image sent previously]' : ''}` }]
                    });
                }
            });
        }

        // regenerate 模式：最后一条用户消息已经在 messages 里了，这里不再追加“新用户消息”
        let currentParts = isRegenerateMode ? null : [{ text: prompt }];

        // Handle Image Input (URL from Blob)
        let dbImageEntry = null;
        let dbImageMimeType = null;

        if (!isRegenerateMode && config?.image?.url) {
            const { base64Data, mimeType } = await fetchImageAsBase64(config.image.url);

            currentParts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                },
                ...(config.mediaResolution ? { mediaResolution: { level: config.mediaResolution } } : {})
            });
            dbImageEntry = config.image.url;
            dbImageMimeType = mimeType;
        }

        if (!isRegenerateMode) {
            contents.push({
                role: "user",
                parts: currentParts
            });
        }

        // 2. Prepare Payload
        const systemText = config?.systemPrompt || "You are a helpful AI assistant.";
        const payload = {
            model: model,
            contents: contents,
            config: {
                systemInstruction: {
                    parts: [{ text: systemText }]
                },
                ...config?.generationConfig
            }
        };

        if (config?.thinkingLevel) {
            if (!payload.config) payload.config = {};
            payload.config.thinkingConfig = {
                thinkingLevel: config.thinkingLevel,
                includeThoughts: true  // 获取思考过程摘要
            };
        }

        // 启用 Google Search 工具（所有模型均可联网）
        if (!payload.config) payload.config = {};
        payload.config.tools = [{ googleSearch: {} }];

        // 3. Database Logic
        if (user && !isRegenerateMode) {
            const storedUserParts = [];
            if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });
            if (isNonEmptyString(dbImageEntry)) {
                storedUserParts.push({
                    inlineData: {
                        mimeType: dbImageMimeType || 'image/jpeg',
                        url: dbImageEntry,
                    },
                });
            }
            const userMsgTime = Date.now();
            const updatedConv = await Conversation.findByIdAndUpdate(currentConversationId, {
                $push: {
                    messages: {
                        role: 'user',
                        content: prompt,
                        type: 'text',
                        image: dbImageEntry, // URL
                        ...(dbImageMimeType ? { mimeType: dbImageMimeType } : {}),
                        parts: storedUserParts
                    }
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            // 记录写入许可时间
            writePermitTime = updatedConv?.updatedAt?.getTime?.() || userMsgTime;
        }

        // 4. Generate Response
        // Text Stream - 使用 SSE 格式以解决移动端缓冲问题
        const streamResult = await ai.models.generateContentStream({
            model: model,
            contents: contents,
            config: payload.config
        });

        const encoder = new TextEncoder();
        // 客户端点击“停止/取消”会中断请求；此时必须停止生成并且不要把结果写入 DB
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch {
            // ignore
        }

        // 填充字符串，用于突破缓冲区阈值（移动端浏览器/CDN 通常有 1KB-4KB 的缓冲）
        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 15000;
        let heartbeatTimer = null;

        const stream = new ReadableStream({
            async start(controller) {
                let fullText = "";
                let fullThought = "";
                try {
                    // 心跳：避免移动端/代理层在长时间无输出时断开连接
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch (e) {
                            // ignore
                        }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    // 立即发送一次，尽早"打开"流并减少首包缓冲
                    sendHeartbeat();

                    for await (const chunk of streamResult) {
                        if (clientAborted) break;
                        const parts = chunk.candidates?.[0]?.content?.parts || [];

                        for (const part of parts) {
                            if (clientAborted) break;
                            // 首次发送时附加填充以突破缓冲
                            const padding = !paddingSent ? PADDING : '';
                            paddingSent = true;

                            if (part.thought && part.text) {
                                fullThought += part.text;
                                const data = `data: ${JSON.stringify({ type: 'thought', content: part.text })}${padding}\n\n`;
                                controller.enqueue(encoder.encode(data));
                            } else if (part.text) {
                                fullText += part.text;
                                const data = `data: ${JSON.stringify({ type: 'text', content: part.text })}${padding}\n\n`;
                                controller.enqueue(encoder.encode(data));
                            }
                        }
                    }

                    // 取消/断连：直接结束，不写 DB，不发送 DONE（避免“旧请求晚写入”导致重复回答）
                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    // 发送结束信号
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    // 只有当会话未被其他请求覆盖时才写入（防止停止后 regenerate 导致重复回答）
                    // writePermitTime 为 null 表示未登录或新建会话前的情况，此时允许写入
                    if (user && currentConversationId) {
                        const writeCondition = writePermitTime
                            ? { _id: currentConversationId, updatedAt: { $lte: new Date(writePermitTime) } }
                            : { _id: currentConversationId };
                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            {
                                $push: {
                                    messages: {
                                        role: 'model',
                                        content: fullText,
                                        thought: fullThought || null,
                                        type: 'text'
                                    }
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
                    controller.error(err);
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
        console.error("Chat API Error:", {
            message: error?.message,
            status: error?.status,
            stack: error?.stack,
            name: error?.name,
            code: error?.code
        });

        const status = typeof error?.status === 'number' ? error.status : 500;

        // Provide user-friendly error messages
        let errorMessage = error?.message || "Internal Server Error";

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
