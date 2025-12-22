import { GoogleGenAI } from "@google/genai";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';

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
        let currentConversationId = conversationId;

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // 1. Prepare Request Contents
        let contents = [];
        const limit = parseInt(historyLimit);
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

        let currentParts = [{ text: prompt }];

        // Handle Image Input (URL from Blob)
        let dbImageEntry = null;

        if (config?.image?.url) {
            const imgRes = await fetch(config.image.url);
            if (!imgRes.ok) throw new Error("Failed to fetch image from blob");
            const arrayBuffer = await imgRes.arrayBuffer();
            const base64Data = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

            currentParts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                },
                ...(config.mediaResolution ? { mediaResolution: { level: config.mediaResolution } } : {})
            });
            dbImageEntry = config.image.url;
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

        if (model === 'gemini-3-pro-image-preview') {
            if (config?.imageConfig) payload.config.imageConfig = config.imageConfig;
        }

        // 3. Database Logic
        if (user) {
            if (!currentConversationId) {
                const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
                const newConv = await Conversation.create({
                    userId: user.userId,
                    title: title,
                    messages: []
                });
                currentConversationId = newConv._id.toString();
            }

            await Conversation.findByIdAndUpdate(currentConversationId, {
                $push: {
                    messages: {
                        role: 'user',
                        content: prompt,
                        type: 'text',
                        image: dbImageEntry // Save URL here!
                    }
                },
                updatedAt: Date.now()
            });
        }

        // 4. Generate Response
        if (model === 'gemini-3-pro-image-preview') {
            const response = await ai.models.generateContent({
                model: model,
                contents: contents,
                config: payload.config
            });
            const parts = response.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData);

            if (imagePart) {
                if (user && currentConversationId) {
                    await Conversation.findByIdAndUpdate(currentConversationId, {
                        $push: {
                            messages: {
                                role: 'model',
                                content: '[Generated Image]',
                                type: 'image'
                            }
                        },
                        updatedAt: Date.now()
                    });
                }
                return Response.json({
                    type: 'image',
                    mimeType: imagePart.inlineData.mimeType,
                    data: imagePart.inlineData.data,
                    conversationId: currentConversationId
                });
            }

            const textContent = parts.map(p => p.text).join('') || "No content.";
            if (user && currentConversationId) {
                await Conversation.findByIdAndUpdate(currentConversationId, {
                    $push: { messages: { role: 'model', content: textContent, type: 'text' } },
                    updatedAt: Date.now()
                });
            }
            return Response.json({ type: 'text', content: textContent, conversationId: currentConversationId });

        } else {
            // Text Stream
            const streamResult = await ai.models.generateContentStream({
                model: model,
                contents: contents,
                config: payload.config
            });
            const stream = new ReadableStream({
                async start(controller) {
                    let fullText = "";
                    let fullThought = "";
                    try {
                        for await (const chunk of streamResult) {
                            // 从 candidates 中提取 parts
                            const parts = chunk.candidates?.[0]?.content?.parts || [];

                            for (const part of parts) {
                                if (part.thought && part.text) {
                                    // 这是思考内容
                                    fullThought += part.text;
                                    const data = JSON.stringify({ type: 'thought', content: part.text }) + '\n';
                                    controller.enqueue(new TextEncoder().encode(data));
                                } else if (part.text) {
                                    // 这是正文内容
                                    fullText += part.text;
                                    const data = JSON.stringify({ type: 'text', content: part.text }) + '\n';
                                    controller.enqueue(new TextEncoder().encode(data));
                                }
                            }
                        }
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
            const headers = { 'Content-Type': 'application/x-ndjson; charset=utf-8' };
            if (currentConversationId) { headers['X-Conversation-Id'] = currentConversationId; }
            return new Response(stream, { headers });
        }

    } catch (error) {
        console.error("Gemini API Error:", error);
        return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
