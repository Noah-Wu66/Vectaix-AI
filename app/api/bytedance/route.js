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
import { buildBytedanceInputFromHistory, buildSeedMessageInput } from '@/app/api/bytedance/bytedanceHelpers';
import {
    SEED_MODEL_ID,
    isSeedModel,
    normalizeModelId,
    toZenmuxModel,
} from '@/lib/shared/models';
import { resolveSeedProviderConfig } from '@/lib/modelRoutes';
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
    extractSeedFunctionCalls,
    extractSeedResponseReasoning,
    extractSeedResponseText,
    normalizeSeedOutputItems,
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
import {
    createWebBrowsingRuntime,
    executeWebBrowsingNativeToolCall,
    getOpenAIWebTools,
    WEB_BROWSING_MAX_ROUNDS,
} from '@/lib/server/webBrowsing/nativeTools';

function findLatestSeedResponseId(messages) {
    if (!Array.isArray(messages)) return '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const responseId = typeof message?.providerState?.seed?.responseId === 'string'
            ? message.providerState.seed.responseId.trim()
            : '';
        if (responseId) return responseId;
    }
    return '';
}

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

        const { baseUrl: seedBaseUrl, apiKey } = resolveSeedProviderConfig();

        const conversationModel = normalizeModelId(model);
        const apiModel = toZenmuxModel(conversationModel);
        if (!isSeedModel(conversationModel)) {
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
        const currentTurnInput = !isRegenerateMode && seedInput.length > 0
            ? seedInput[seedInput.length - 1]
            : null;
        const latestSeedResponseId = isRegenerateMode ? '' : findLatestSeedResponseId(effectiveHistoryMessages);

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

                    const instructions = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const requestSeedJson = async (requestBody) => {
                        const response = await requestSeedResponses({
                            apiKey,
                            baseUrl: seedBaseUrl,
                            requestBody,
                            req,
                        });
                        return response.json();
                    };

                    const usePreviousResponseId = Boolean(latestSeedResponseId && currentTurnInput);
                    let nextInput = usePreviousResponseId ? [currentTurnInput] : seedInput;
                    let previousResponseId = usePreviousResponseId ? latestSeedResponseId : '';
                    let finalPayload = null;
                    const toolRecords = [];
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const maxRounds = enableWebSearch ? WEB_BROWSING_MAX_ROUNDS : 1;

                    for (let round = 0; round < maxRounds; round += 1) {
                        const requestBody = buildSeedRequestBody({
                            model: apiModel || SEED_MODEL_ID,
                            input: nextInput,
                            instructions,
                            maxTokens,
                            thinkingLevel,
                            stream: false,
                        });
                        requestBody.store = true;
                        if (previousResponseId) {
                            requestBody.previous_response_id = previousResponseId;
                        }
                        if (enableWebSearch) {
                            requestBody.tools = getOpenAIWebTools();
                        }

                        const payload = await requestSeedJson(requestBody);
                        if (clientAborted) break;

                        const thought = extractSeedResponseReasoning(payload);
                        if (thought) {
                            fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            sendEvent({ type: 'thought', content: thought });
                        }

                        const functionCalls = enableWebSearch ? extractSeedFunctionCalls(payload) : [];
                        if (functionCalls.length === 0) {
                            finalPayload = payload;
                            fullText = extractSeedResponseText(payload);
                            if (fullText) {
                                sendEvent({ type: 'text', content: fullText });
                            }
                            break;
                        }

                        previousResponseId = typeof payload?.id === 'string' ? payload.id : previousResponseId;
                        nextInput = [];
                        for (const functionCall of functionCalls) {
                            const toolExecution = await executeWebBrowsingNativeToolCall({
                                apiName: functionCall.name,
                                argumentsInput: functionCall.arguments,
                                runtime,
                                sendEvent,
                                pushCitations,
                                round: round + 1,
                                signal: req?.signal,
                            });
                            toolRecords.push(toolExecution.toolRecord);
                            nextInput.push({
                                type: 'function_call_output',
                                call_id: functionCall.call_id,
                                output: toolExecution.outputText,
                            });
                        }
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (!finalPayload && !clientAborted) {
                        throw new Error('Seed 工具循环未返回最终答案');
                    }

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
                            tools: enableWebSearch && toolRecords.length > 0 ? toolRecords : null,
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }],
                            providerState: finalPayload
                                ? {
                                    seed: {
                                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                                        output: normalizeSeedOutputItems(finalPayload?.output),
                                    },
                                }
                                : null,
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
            errorMessage = 'Seed 接口认证失败，请检查 ZENMUX_API_KEY';
        } else if (error?.message?.includes('ZENMUX_API_KEY')) {
            errorMessage = 'Seed 接口未正确配置，请检查 ZENMUX_API_KEY';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
