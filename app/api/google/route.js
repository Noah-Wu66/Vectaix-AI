import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import {
    fetchBlobAsBase64,
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessagesStrict,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    estimateTokens
} from '@/app/api/chat/utils';
import { getAttachmentInputType } from '@/lib/shared/attachments';
import {
    buildAttachmentTextBlock,
    prepareDocumentAttachmentMapByUrls,
} from '@/lib/server/files/service';
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
    buildWebSearchGuide,
} from '@/lib/server/chat/webSearchConfig';
import {
    parseGeminiThinkingLevel,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import { createGeminiClient, resolveGeminiApiModel } from '@/lib/server/chat/providerAdapters';
import { runWebBrowsingSession } from '@/lib/server/webBrowsing/session';
import { runWebBrowsingActionText } from '@/lib/server/webBrowsing/actionRunner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

async function storedPartToRequestPart(part, options = {}) {
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

    const fileUrl = part?.fileData?.url;
    const inputType = getAttachmentInputType(part?.fileData?.category);
    if (isNonEmptyString(fileUrl) && inputType === 'file') {
        const fileTextMap = options?.fileTextMap instanceof Map ? options.fileTextMap : new Map();
        const prepared = fileTextMap.get(fileUrl);
        const extractedText = prepared?.structuredText || prepared?.extractedText || '';
        if (isNonEmptyString(extractedText)) {
            return { text: buildAttachmentTextBlock(prepared.file || part.fileData, extractedText) };
        }
    }
    if (isNonEmptyString(fileUrl) && (inputType === 'video' || inputType === 'audio')) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(fileUrl, { resourceLabel: inputType });
        const mimeType = part.fileData?.mimeType || fetchedMimeType;
        return { inlineData: { mimeType, data: base64Data } };
    }

    return null;
}

async function buildGeminiContentsFromMessages(messages, options = {}) {
    const contents = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;
        const parts = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToRequestPart(storedPart, options);
            if (p) parts.push(p);
        }
        if (parts.length) contents.push({ role: msg.role, parts });
    }
    return contents;
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

        if (typeof prompt !== 'string') {
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

        const apiModel = resolveGeminiApiModel(model);
        const ai = await createGeminiClient(user.userId);
        let currentConversationId = conversationId;
        let currentConversation = await loadConversationForRoute({
            conversationId: currentConversationId,
            userId: user.userId,
            expectedProvider: 'gemini',
        });
        let createdConversationForRequest = false;
        let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
        let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();

        let contents = [];
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
            const historyAttachmentUrls = effectiveMsgs.flatMap((msg) =>
                Array.isArray(msg?.parts)
                    ? msg.parts
                        .map((part) => part?.fileData)
                        .filter((file) => getAttachmentInputType(file?.category) === 'file' && isNonEmptyString(file?.url))
                        .map((file) => file.url)
                    : []
            );
            const historyFileTextMap = await prepareDocumentAttachmentMapByUrls(historyAttachmentUrls, {
                userId: user.userId,
                conversationId: currentConversationId,
                signal: req?.signal,
            });
            contents = await buildGeminiContentsFromMessages(effectiveMsgs, { fileTextMap: historyFileTextMap });
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistoryMessages = effectiveHistory;
            const historyAttachmentUrls = effectiveHistory.flatMap((msg) =>
                Array.isArray(msg?.parts)
                    ? msg.parts
                        .map((part) => part?.fileData)
                        .filter((file) => getAttachmentInputType(file?.category) === 'file' && isNonEmptyString(file?.url))
                        .map((file) => file.url)
                    : []
            );
            const historyFileTextMap = await prepareDocumentAttachmentMapByUrls(historyAttachmentUrls, {
                userId: user.userId,
                conversationId: currentConversationId,
                signal: req?.signal,
            });
            contents = await buildGeminiContentsFromMessages(effectiveHistory, { fileTextMap: historyFileTextMap });
        }

        const mediaAttachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => {
                const inputType = getAttachmentInputType(item?.category);
                return (inputType === 'video' || inputType === 'audio') && isNonEmptyString(item?.url);
            })
            : [];
        const documentAttachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => getAttachmentInputType(item?.category) === 'file' && isNonEmptyString(item?.url))
            : [];
        let currentParts = isRegenerateMode ? null : [];
        let dbImageEntries = [];
        const dbAttachmentEntries = [];

        if (!isRegenerateMode && isNonEmptyString(prompt)) {
            currentParts.push({ text: prompt });
        }

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

        if (!isRegenerateMode && mediaAttachmentEntries.length > 0) {
            for (const attachment of mediaAttachmentEntries) {
                const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, {
                    resourceLabel: getAttachmentInputType(attachment.category) || 'media',
                });
                const mimeType = attachment.mimeType || fetchedMimeType;
                currentParts.push({
                    inlineData: {
                        mimeType,
                        data: base64Data,
                    },
                });
                dbAttachmentEntries.push(attachment);
            }
        }

        if (!isRegenerateMode && documentAttachmentEntries.length > 0) {
            const preparedAttachments = await prepareDocumentAttachmentMapByUrls(
                documentAttachmentEntries.map((item) => item.url),
                {
                    userId: user.userId,
                    conversationId: currentConversationId,
                    signal: req?.signal,
                }
            );
            for (const attachment of documentAttachmentEntries) {
                const prepared = preparedAttachments.get(attachment.url);
                const extractedText = prepared?.structuredText || prepared?.extractedText || '';
                if (!isNonEmptyString(extractedText)) continue;
                currentParts.push({ text: buildAttachmentTextBlock(prepared.file || attachment, extractedText) });
                dbAttachmentEntries.push(attachment);
            }
        }

        if (!isRegenerateMode && currentParts.length === 0) {
            return Response.json({ error: '请至少输入内容或上传附件' }, { status: 400 });
        }

        if (!isRegenerateMode) {
            contents.push({
                role: "user",
                parts: currentParts
            });
        }

        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const baseSystemText = await injectCurrentTimeSystemReminder(userSystemPrompt);
        const generationConfig = (config?.generationConfig && typeof config.generationConfig === 'object' && !Array.isArray(config.generationConfig))
            ? config.generationConfig
            : {};
        const safeGenerationConfig = { ...generationConfig };
        delete safeGenerationConfig.temperature;
        let maxTokens;
        let thinkingLevel;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
            thinkingLevel = parseGeminiThinkingLevel(config?.thinkingLevel);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
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

        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);
        const webSearchGuide = buildWebSearchGuide(enableWebSearch);
        const runWebBrowsingAction = ({ systemText, userText, maxTokens }) => runWebBrowsingActionText({
            maxTokens,
            model,
            req,
            systemText,
            thinkingLevel,
            userId: user.userId,
            userText,
        });
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        if (user && !currentConversationId) {
            const titleSource = isNonEmptyString(prompt)
                ? prompt
                : (dbAttachmentEntries[0]?.name || (dbImageEntries.length > 0 ? '图片对话' : 'New Chat'));
            const title = titleSource.length > 30 ? titleSource.substring(0, 30) + '...' : titleSource;
            const newConv = await Conversation.create({
                userId: user.userId,
                title,
                model,
                settings: {
                    ...(settings && typeof settings === 'object' ? settings : {}),
                    webSearch: parseWebSearchConfig(config?.webSearch),
                },
                messages: [],
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

            if (dbAttachmentEntries.length > 0) {
                for (const attachment of dbAttachmentEntries) {
                    storedUserParts.push({
                        fileData: {
                            url: attachment.url,
                            name: attachment.name,
                            mimeType: attachment.mimeType,
                            size: attachment.size,
                            extension: attachment.extension,
                            category: attachment.category,
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

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url || seenUrls.has(item.url)) continue;
                            seenUrls.add(item.url);
                            citations.push({ url: item.url, title: item.title });
                        }
                    };

                    const { contextText: webBrowsingContextText } = await runWebBrowsingSession({
                        actionRunner: runWebBrowsingAction,
                        enableWebSearch,
                        webSearchOptions: webSearchConfig,
                        prompt,
                        historyMessages: effectiveHistoryMessages,
                        sendEvent,
                        pushCitations,
                        isClientAborted: () => clientAborted,
                        signal: req?.signal,
                    });

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    const searchContextSection = webBrowsingContextText || "";
                    if (searchContextSection) {
                        searchContextTokens = estimateTokens(searchContextSection);
                        sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                    }

                    const finalSystemPrompt = `${baseSystemText}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}${systemPromptSuffix.trim() ? `\n\n${systemPromptSuffix}` : ''}`;
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
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    if (citations.length > 0) {
                        sendEvent({ type: 'citations', citations });
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (user && currentConversationId) {
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
                        try { await rollbackCurrentTurn(); } catch { /* ignore */ }
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }
                    try { await rollbackCurrentTurn(); } catch { /* ignore */ }
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
