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

        // 区域日志
        const region = process.env.VERCEL_REGION || 'unknown';
        console.log(`[Chat Request] Model: ${model} | Region: ${region} | Time: ${new Date().toISOString()}`);

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
        const isImageModel = model === 'gemini-3-pro-image-preview';

        let currentConversationId = conversationId;

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Image multi-turn requires persistent history (signatures + images)
        if (isImageModel && !user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

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
            const conv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                { $set: { messages: sanitized, updatedAt: Date.now() } },
                { new: true }
            ).select('messages');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = conv.messages || [];
        }

        if (isImageModel) {
            const conv = isRegenerateMode
                ? { messages: storedMessagesForRegenerate }
                : await Conversation.findOne({ _id: currentConversationId, userId: user.userId }).select('messages');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            const msgs = (limit > 0 && Number.isFinite(limit)) ? conv.messages.slice(-limit) : conv.messages;
            contents = await buildGeminiContentsFromMessages(msgs);
        } else {
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

        if (isImageModel) {
            payload.config.responseModalities = ['TEXT', 'IMAGE'];
            if (config?.imageConfig) payload.config.imageConfig = config.imageConfig;
        }

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
            await Conversation.findByIdAndUpdate(currentConversationId, {
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
                updatedAt: Date.now()
            });
        }

        // 4. Generate Response
        if (isImageModel) {
            const response = await ai.models.generateContent({
                model: model,
                contents: contents,
                config: payload.config
            });
            const rawParts = response.candidates?.[0]?.content?.parts || [];
            const parts = rawParts.filter(p => !p?.thought);

            const storedModelParts = [];
            let imageIdx = 0;

            for (const part of parts) {
                if (isNonEmptyString(part?.text)) {
                    const p = { text: part.text };
                    if (isNonEmptyString(part?.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
                    storedModelParts.push(p);
                    continue;
                }

                const inline = part?.inlineData;
                if (inline?.data) {
                    const mimeType = inline.mimeType || 'image/png';
                    const buffer = Buffer.from(inline.data, 'base64');
                    const ext = mimeTypeToExt(mimeType);
                    const filename = `gemini/${currentConversationId}/${Date.now()}-${imageIdx}.${ext}`;
                    const blob = await put(filename, buffer, { access: 'public', contentType: mimeType });
                    const p = { inlineData: { mimeType, url: blob.url } };
                    if (isNonEmptyString(part?.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
                    storedModelParts.push(p);
                    imageIdx += 1;
                }
            }

            const textContent = storedModelParts.map(p => p.text).filter(Boolean).join('') || '';
            if (user && currentConversationId) {
                await Conversation.findByIdAndUpdate(currentConversationId, {
                    $push: { messages: { role: 'model', content: textContent, type: 'parts', parts: storedModelParts } },
                    updatedAt: Date.now()
                });
            }

            return Response.json({
                type: 'parts',
                parts: storedModelParts,
                conversationId: currentConversationId
            });

        } else {
            // Text Stream - 使用 SSE 格式以解决移动端缓冲问题
            const streamResult = await ai.models.generateContentStream({
                model: model,
                contents: contents,
                config: payload.config
            });
            
            const encoder = new TextEncoder();
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
                                controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                            } catch (e) {
                                // ignore
                            }
                        };
                        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                        // 立即发送一次，尽早“打开”流并减少首包缓冲
                        sendHeartbeat();

                        for await (const chunk of streamResult) {
                            const parts = chunk.candidates?.[0]?.content?.parts || [];

                            for (const part of parts) {
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
                        
                        // 发送结束信号
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        
                        if (user && currentConversationId) {
                            await Conversation.findByIdAndUpdate(currentConversationId, {
                                $push: {
                                    messages: {
                                        role: 'model',
                                        content: fullText,
                                        thought: fullThought || null,
                                        type: 'text'
                                    }
                                },
                                updatedAt: Date.now()
                            });
                        }
                        controller.close();
                    } catch (err) {
                        controller.error(err);
                    } finally {
                        if (heartbeatTimer) {
                            clearInterval(heartbeatTimer);
                            heartbeatTimer = null;
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
        }

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
