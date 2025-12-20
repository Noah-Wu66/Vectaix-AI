import { GoogleGenAI } from "@google/genai";
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'default_secret_key_change_me');

async function getUser() {
    const token = cookies().get('token')?.value;
    if (!token) return null;
    try {
        const verified = await jwtVerify(token, SECRET_KEY);
        await dbConnect();
        const user = await User.findById(verified.payload.userId);
        return user ? verified.payload : null;
    } catch {
        return null;
    }
}

export async function POST(req) {
    try {
        const { prompt, model, config, history = [], historyLimit = 0, conversationId } = await req.json();

        const user = await getUser();
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

        // Handle Image Input (URL from Blob or Base64 legacy)
        let dbImageEntry = null;

        if (config?.image) {
            if (config.image.url) {
                // Fetch remote image (Vercel Blob)
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
                dbImageEntry = config.image.url; // Use URL for DB
            } else if (config.image.data) {
                // Legacy Base64
                currentParts.push({
                    inlineData: {
                        mimeType: config.image.mimeType,
                        data: config.image.data
                    },
                    ...(config.mediaResolution ? { mediaResolution: { level: config.mediaResolution } } : {})
                });
                dbImageEntry = "Image Attached (Base64)"; // Don't save large base64
            }
        }

        contents.push({
            role: "user",
            parts: currentParts
        });

        // 2. Prepare Payload
        const payload = {
            model: model,
            contents: contents,
            config: {
                ...(model !== 'gemini-3-pro-image-preview' ? {
                    systemInstruction: {
                        parts: [{ text: "You are a helpful AI. When solving problems, you may display your internal thought process. If you do, please enclose the thinking process within <thinking> and </thinking> tags." }]
                    }
                } : {}),
                ...config?.generationConfig
            }
        };

        if (config?.thinkingLevel) {
            if (!payload.config) payload.config = {};
            payload.config.thinkingConfig = { thinkingLevel: config.thinkingLevel };
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
                                content: '[Generated Image]', // Placeholder unless we upload generated image to blob too? 
                                // For now, text placeholder. Saving generated images persistent requires another upload. 
                                // User only asked to bypass limit for Request Body (User Upload).
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
                    try {
                        for await (const chunk of streamResult) {
                            const chunkText = chunk.text;
                            if (chunkText) {
                                fullText += chunkText;
                                controller.enqueue(new TextEncoder().encode(chunkText));
                            }
                        }
                        if (user && currentConversationId) {
                            const thinkingMatch = fullText.match(/<thinking>([\s\S]*?)<\/thinking>/);
                            const thought = thinkingMatch ? thinkingMatch[1] : null;

                            await Conversation.findByIdAndUpdate(currentConversationId, {
                                $push: {
                                    messages: {
                                        role: 'model',
                                        content: fullText,
                                        thought: thought,
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
            const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
            if (currentConversationId) { headers['X-Conversation-Id'] = currentConversationId; }
            return new Response(stream, { headers });
        }

    } catch (error) {
        console.error("Gemini API Error:", error);
        return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
