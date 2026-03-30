import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import {
    fetchBlobAsBase64,
    fetchImageAsBase64,
    estimateTokens,
    generateMessageId,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
} from '@/app/api/chat/utils';
import { runWebBrowsingSession } from '@/lib/server/webBrowsing/session';
import { runWebBrowsingActionText } from '@/lib/server/webBrowsing/actionRunner';
import { buildBytedanceInputFromHistory, buildSeedMessageInput } from '@/app/api/bytedance/bytedanceHelpers';
import {
    SEED_MODEL_ID,
    isSeedModel,
    normalizeModelId,
} from '@/lib/shared/models';
import { buildDirectChatSystemPrompt } from '@/lib/server/chat/systemPromptBuilder';
import {
    parseMaxTokens,
    parseSeedThinkingLevel,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import {
    buildSeedRequestBody,
    extractSeedResponseText,
    normalizeSeedChunkText,
    requestSeedResponses,
} from '@/lib/server/seed/service';
import { getAttachmentInputType } from '@/lib/shared/attachments';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

function pushUniqueCitations(target, items) {
    if (!Array.isArray(target) || !Array.isArray(items)) return;
    for (const item of items) {
        if (!item?.url) continue;
        if (!target.some((citation) => citation.url === item.url)) {
            target.push(item);
        }
    }
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

        const {
            prompt,
            model,
            config,
            history,
            historyLimit,
            conversationId,
            mode,
            messages,
            userMessageId,
            modelMessageId,
        } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (typeof prompt !== 'string') {
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
            console.error('Database connection error:', dbError?.message);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        const apiKey = process.env.ARK_API_KEY;
        if (!apiKey) {
            return Response.json({ error: 'ARK_API_KEY 未配置' }, { status: 500 });
        }

        const conversationModel = normalizeModelId(model);
        const apiModel = conversationModel;
        if (!isSeedModel(apiModel)) {
            return Response.json({ error: '当前接口仅支持官方 Seed 模型' }, { status: 400 });
        }

        let currentConversationId = conversationId;
        let currentConversation = await loadConversationForRoute({
            conversationId: currentConversationId,
            userId: user.userId,
            expectedProvider: 'seed',
        });
        let createdConversationForRequest = false;
        let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
        let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();

        let seedInput = [];
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
            } catch (error) {
                return Response.json({ error: error?.message || 'messages invalid' }, { status: 400 });
            }

            sanitized = await enrichStoredMessagesWithBlobIds(sanitized, { userId: user.userId });
            const regenerateTime = Date.now();
            const conv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                { $set: { messages: sanitized, updatedAt: regenerateTime } },
                { new: true }
            ).select('messages updatedAt');

            if (!conv) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }

            storedMessagesForRegenerate = sanitized;
            writePermitTime = conv.updatedAt?.getTime?.();
        }

        if (isRegenerateMode) {
            const effectiveMessages = (limit > 0 && Number.isFinite(limit))
                ? storedMessagesForRegenerate.slice(-limit)
                : storedMessagesForRegenerate;
            const historyBeforeCurrentPrompt = Array.isArray(storedMessagesForRegenerate)
                && storedMessagesForRegenerate[storedMessagesForRegenerate.length - 1]?.role === 'user'
                ? storedMessagesForRegenerate.slice(0, -1)
                : storedMessagesForRegenerate;
            effectiveHistoryMessages = (limit > 0 && Number.isFinite(limit))
                ? historyBeforeCurrentPrompt.slice(-limit)
                : historyBeforeCurrentPrompt;
            seedInput = await buildBytedanceInputFromHistory(effectiveMessages);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit))
                ? safeHistory.slice(-limit)
                : safeHistory;
            effectiveHistoryMessages = effectiveHistory;
            seedInput = await buildBytedanceInputFromHistory(effectiveHistory);
        }

        const attachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => {
                const inputType = getAttachmentInputType(item?.category);
                return (inputType === 'video' || inputType === 'audio') && isNonEmptyString(item?.url);
            })
            : [];
        const dbImageEntries = [];
        if (!isRegenerateMode) {
            const userContent = [];
            if (isNonEmptyString(prompt)) {
                userContent.push({ type: 'input_text', text: prompt });
            }

            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (!img?.url) continue;
                    const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                    userContent.push({
                        type: 'input_image',
                        image_url: `data:${mimeType};base64,${base64Data}`,
                    });
                    dbImageEntries.push({ url: img.url, mimeType });
                }
            }

            for (const attachment of attachmentEntries) {
                const inputType = getAttachmentInputType(attachment.category);
                const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, {
                    resourceLabel: inputType || 'media',
                });
                const mimeType = attachment.mimeType || fetchedMimeType;
                if (inputType === 'video') {
                    userContent.push({
                        type: 'input_video',
                        video_url: `data:${mimeType};base64,${base64Data}`,
                    });
                    continue;
                }
                if (inputType === 'audio') {
                    userContent.push({
                        type: 'input_audio',
                        audio_url: `data:${mimeType};base64,${base64Data}`,
                    });
                }
            }

            if (userContent.length === 0) {
                return Response.json({ error: '请至少输入内容或上传附件' }, { status: 400 });
            }

            const userMessageInput = buildSeedMessageInput({ role: 'user', content: userContent });
            if (userMessageInput) {
                seedInput.push(userMessageInput);
            }
        }

        let maxTokens;
        let thinkingLevel;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
            thinkingLevel = parseSeedThinkingLevel(config?.thinkingLevel);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);
        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const runWebBrowsingAction = ({ systemText, userText, maxTokens }) => runWebBrowsingActionText({
            apiKey,
            maxTokens,
            model: conversationModel,
            req,
            systemText,
            thinkingLevel,
            userId: user.userId,
            userText,
        });

        if (user && !currentConversationId) {
            const titleSource = isNonEmptyString(prompt)
                ? prompt
                : (Array.isArray(config?.attachments) && config.attachments[0]?.name
                    ? `附件：${config.attachments[0].name}`
                    : 'New Chat');
            const title = titleSource.length > 30 ? `${titleSource.substring(0, 30)}...` : titleSource;
            const newConv = await Conversation.create({
                userId: user.userId,
                title,
                model: conversationModel,
                settings: {
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
            if (attachmentEntries.length > 0) {
                for (const attachment of attachmentEntries) {
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
                content: typeof prompt === 'string' ? prompt : '',
                type: 'parts',
                parts: enrichedStoredUserParts,
            };

            const updatedConv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                {
                    $push: { messages: userMessage },
                    updatedAt: userMsgTime,
                },
                { new: true }
            ).select('updatedAt');

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
        } catch { }

        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 15000;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = '';
                let fullThought = '';
                const citations = [];
                let searchContextTokens = 0;
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
                        } catch { }
                    };

                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
                    };

                    const pushCitations = (items) => {
                        pushUniqueCitations(citations, items);
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
                        try { controller.close(); } catch { }
                        return;
                    }

                    const searchContextSection = webBrowsingContextText || '';
                    if (searchContextSection) {
                        searchContextTokens = estimateTokens(searchContextSection);
                        sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                    }

                    const instructions = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection,
                        includeEconomyPrefix: false,
                    });
                    const requestBody = buildSeedRequestBody({
                        model: apiModel || SEED_MODEL_ID,
                        input: seedInput,
                        instructions,
                        maxTokens,
                        thinkingLevel,
                    });

                    const response = await requestSeedResponses({
                        apiKey,
                        requestBody,
                        req,
                    });

                    if (!response.body) {
                        throw new Error('Seed 官方接口返回了空响应体，请稍后重试');
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    const handleEvent = (event) => {
                        const eventType = typeof event?.type === 'string' ? event.type : '';

                        if (eventType === 'response.output_text.delta') {
                            const text = normalizeSeedChunkText(event?.delta);
                            if (!text) return;
                            fullText += text;
                            sendEvent({ type: 'text', content: text });
                            return;
                        }

                        if (eventType === 'response.reasoning.delta' || eventType === 'response.reasoning_summary_text.delta') {
                            const thought = normalizeSeedChunkText(event?.delta);
                            if (!thought) return;
                            fullThought += thought;
                            sendEvent({ type: 'thought', content: thought });
                            return;
                        }
                    };

                    const consumeSseBuffer = (final = false) => {
                        const blocks = buffer.split(/\r?\n\r?\n/);
                        buffer = final ? '' : (blocks.pop() || '');

                        for (const block of blocks) {
                            const trimmedBlock = block.trim();
                            if (!trimmedBlock) continue;

                            const lines = trimmedBlock.split(/\r?\n/);
                            const dataLines = [];
                            for (const line of lines) {
                                if (!line || line.startsWith(':')) continue;
                                if (line.startsWith('data:')) {
                                    dataLines.push(line.slice(5).replace(/^\s*/, ''));
                                }
                            }

                            if (!dataLines.length) continue;
                            const dataStr = dataLines.join('\n');
                            if (dataStr === '[DONE]') continue;

                            try {
                                handleEvent(JSON.parse(dataStr));
                            } catch { }
                        }
                    };

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done || clientAborted) break;

                        buffer += decoder.decode(value, { stream: true });
                        consumeSseBuffer(false);
                    }

                    buffer += decoder.decode();
                    consumeSseBuffer(true);

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { }
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
                            parts: [{ text: fullText }],
                        };

                        const persistedConversation = await Conversation.findOneAndUpdate(
                            buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                            {
                                $push: { messages: modelMessage },
                                updatedAt: Date.now(),
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
                } catch (error) {
                    if (clientAborted) {
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }

                    try { await rollbackCurrentTurn(); } catch { }
                    try {
                        const errorPayload = JSON.stringify({
                            type: 'stream_error',
                            message: error?.message || 'Unknown error',
                        });
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    } catch {
                        controller.error(error);
                    }
                } finally {
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    try {
                        req?.signal?.removeEventListener?.('abort', onAbort);
                    } catch { }
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
        console.error('Seed API Error:', {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code,
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const status = rawStatus === 401 ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (rawStatus === 401) {
            errorMessage = 'Seed 官方接口认证失败，请检查 ARK_API_KEY';
        } else if (error?.message?.includes('ARK_API_KEY')) {
            errorMessage = 'Seed 官方接口未正确配置，请检查 ARK_API_KEY';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
