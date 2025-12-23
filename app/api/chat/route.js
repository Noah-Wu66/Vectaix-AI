import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';

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

function getStoredPartsFromMessage(msg) {
    if (Array.isArray(msg?.parts) && msg.parts.length > 0) return msg.parts;

    const parts = [];
    if (isNonEmptyString(msg?.content)) parts.push({ text: msg.content });
    if (isNonEmptyString(msg?.image)) {
        parts.push({
            inlineData: {
                url: msg.image,
                ...(isNonEmptyString(msg?.mimeType) ? { mimeType: msg.mimeType } : {}),
            },
        });
    }
    return parts;
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

export async function POST(req) {
    try {
        const { prompt, model, config, history = [], historyLimit = 0, conversationId } = await req.json();

        const auth = await getAuthPayload();
        let user = null;
        if (auth) {
            await dbConnect();
            const userDoc = await User.findById(auth.userId);
            if (userDoc) user = auth;
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

        if (isImageModel) {
            const conv = await Conversation.findOne({ _id: currentConversationId, userId: user.userId }).select('messages');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            const msgs = (limit > 0 && Number.isFinite(limit)) ? conv.messages.slice(-limit) : conv.messages;
            contents = await buildGeminiContentsFromMessages(msgs);
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

        let currentParts = [{ text: prompt }];

        // Handle Image Input (URL from Blob)
        let dbImageEntry = null;
        let dbImageMimeType = null;

        if (config?.image?.url) {
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

        contents.push({
            role: "user",
            parts: currentParts
        });

        // 2. Prepare Payload
        const systemText = config?.systemPrompt || "You are a helpful AI assistant.";
        const payload = {
            model: model,
            contents: contents,
            config: {
                ...(model !== 'gemini-3-pro-image-preview' ? {
                    systemInstruction: {
                        parts: [{ text: systemText }]
                    }
                } : {}),
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

        // 为所有模型启用 Google Search 联网功能
        if (!payload.config) payload.config = {};
        payload.config.tools = [{ googleSearch: {} }];

        if (isImageModel) {
            payload.config.responseModalities = ['TEXT', 'IMAGE'];
            if (config?.imageConfig) payload.config.imageConfig = config.imageConfig;
        }

        // 3. Database Logic
        if (user) {
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
            const PADDING = ' '.repeat(256);
            let paddingSent = false;
            
            const stream = new ReadableStream({
                async start(controller) {
                    let fullText = "";
                    let fullThought = "";
                    try {
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
                    } catch (err) { controller.error(err); }
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
        console.error("Gemini API Error:", error);
        return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
