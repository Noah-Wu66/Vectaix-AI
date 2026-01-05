import Anthropic from "@anthropic-ai/sdk";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessages
} from '@/app/api/chat/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function storedPartToClaudePart(part) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        return { type: 'text', text: part.text };
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType || fetchedMimeType;
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
    for (const msg of messages || []) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        let storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts) {
            storedParts = [];
            if (isNonEmptyString(msg.content)) {
                storedParts.push({ text: msg.content });
            }
            if (isNonEmptyString(msg.image)) {
                storedParts.push({ inlineData: { url: msg.image, mimeType: msg.mimeType || 'image/jpeg' } });
            }
            if (storedParts.length === 0) continue;
        }

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
        let body;
        try {
            body = await req.json();
        } catch (jsonError) {
            console.error("Invalid JSON in request body:", jsonError);
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { prompt, model, config, history = [], historyLimit = 0, conversationId, mode, messages, settings } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
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
                return Response.json({ error: 'Database connection failed' }, { status: 500 });
            }
        }

        let currentConversationId = conversationId;

        const client = new Anthropic({
            apiKey: process.env.RIGHTCODE_API_KEY,
            baseURL: "https://www.right.codes/claude"
        });

        // 创建新会话
        if (user && !currentConversationId) {
            const title = (prompt || '').length > 30 ? (prompt || '').substring(0, 30) + '...' : (prompt || '');
            const newConv = await Conversation.create({
                userId: user.userId,
                title: title,
                model: model,
                settings: settings || {},
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        let claudeMessages = [];
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
            writePermitTime = conv.updatedAt?.getTime?.() || regenerateTime;
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate || [];
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            for (const msg of effectiveHistory) {
                if (msg.role === 'user' || msg.role === 'model') {
                    claudeMessages.push({
                        role: msg.role === 'model' ? 'assistant' : 'user',
                        content: [{ type: 'text', text: `${msg.content} ${msg.image ? '[Image sent previously]' : ''}` }]
                    });
                }
            }
        }

        let dbImageEntry = null;
        let dbImageMimeType = null;
        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [{ type: 'text', text: prompt }];

            // 支持多张图片
            if (config?.images?.length > 0 || config?.image?.url) {
                const imagesToProcess = config?.images?.length > 0
                    ? config.images
                    : config?.image?.url ? [config.image] : [];

                for (const img of imagesToProcess) {
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

                // 兼容旧的单图片字段
                if (dbImageEntries.length > 0) {
                    dbImageEntry = dbImageEntries[0].url;
                    dbImageMimeType = dbImageEntries[0].mimeType;
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
                            mimeType: entry.mimeType || 'image/jpeg',
                            url: entry.url,
                        },
                    });
                }
            } else if (isNonEmptyString(dbImageEntry)) {
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
                        image: dbImageEntry, // 兼容旧字段，存第一张
                        images: dbImageEntries.map(e => e.url), // 新字段存储所有图片
                        ...(dbImageMimeType ? { mimeType: dbImageMimeType } : {}),
                        parts: storedUserParts
                    }
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.() || userMsgTime;
        }

        // 构建请求参数
        const maxTokens = config?.maxTokens || 65536;
        const budgetTokens = config?.budgetTokens || 32768;
        const systemPrompt = config?.systemPrompt || "You are a helpful AI assistant.";

        const requestParams = {
            model: model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: claudeMessages,
            stream: true,
            thinking: {
                type: "enabled",
                budget_tokens: budgetTokens
            }
        };

        const stream = await client.messages.stream(requestParams);

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

                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch { /* ignore */ }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    for await (const event of stream) {
                        if (clientAborted) break;

                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;

                        if (event.type === 'content_block_delta') {
                            const delta = event.delta;
                            if (delta.type === 'thinking_delta') {
                                fullThought += delta.thinking;
                                const data = `data: ${JSON.stringify({ type: 'thought', content: delta.thinking })}${padding}\n\n`;
                                controller.enqueue(encoder.encode(data));
                            } else if (delta.type === 'text_delta') {
                                fullText += delta.text;
                                const data = `data: ${JSON.stringify({ type: 'text', content: delta.text })}${padding}\n\n`;
                                controller.enqueue(encoder.encode(data));
                            }
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

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
            stack: error?.stack
        });

        const status = typeof error?.status === 'number' ? error.status : 500;
        let errorMessage = error?.message || "Internal Server Error";

        if (error?.message?.includes('API_KEY')) {
            errorMessage = "API configuration error. Please check your API keys.";
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
