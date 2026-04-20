import Conversation from '@/models/Conversation';
import {
    generateMessageId,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
    estimateTokens,
} from '@/app/api/chat/utils';
import { QWEN_MODEL_ID } from '@/lib/shared/models';
import { resolveQwenProviderConfig } from '@/lib/modelRoutes';
import {
    buildDirectChatSystemPrompt,
    buildForcedFinalAnswerInstructions,
} from '@/lib/server/chat/systemPromptBuilder';
import {
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import {
    CONVERSATION_WRITE_CONFLICT_ERROR,
    buildConversationWriteCondition,
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
    WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND,
} from '@/lib/server/webBrowsing/nativeTools';
import {
    createWebBrowsingRoundController,
    getMaxWebBrowsingModelPasses,
} from '@/lib/server/webBrowsing/roundControl';
import {
    CHAT_RATE_LIMIT,
    MAX_REQUEST_BYTES,
    SSE_PADDING,
    HEARTBEAT_INTERVAL_MS,
} from '@/lib/server/chat/routeConstants';
import { consumeStrictResponsesStream } from '@/lib/server/chat/responsesStream';
import { fetchWithZenmuxRateLimit } from '@/lib/server/providers/zenmuxRateLimit';
import {
    buildSseResponseHeaders,
    ensureConversationForChatRequest,
    persistRegenerateConversationMessages,
    persistUserConversationMessage,
    requireChatUser,
    validateChatRequestBody,
} from '@/lib/server/chat/routeHelpers';
import { assertRequestSize, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import {
    buildResponsesInputFromHistory,
    extractOpenAIFunctionCalls,
    extractOpenAIResponseReasoning,
    extractOpenAIResponseText,
    normalizeOpenAIOutputItems,
} from '@/app/api/openai/openaiHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findLatestQwenResponseId(messages) {
    if (!Array.isArray(messages)) return '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const responseId = typeof message?.providerState?.qwen?.responseId === 'string'
            ? message.providerState.qwen.responseId.trim()
            : '';
        if (responseId) return responseId;
    }
    return '';
}

export async function POST(req) {
    let writePermitTime = null;

    try {
        const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const parsed = await parseJsonRequest(req, 'Invalid JSON in request body');
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

        const invalidBodyResponse = validateChatRequestBody(body);
        if (invalidBodyResponse) return invalidBodyResponse;

        const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
        if (authResult?.response) return authResult.response;
        const user = authResult.auth;

        const { baseUrl: qwenBaseUrl, apiKey } = resolveQwenProviderConfig();
        const apiModel = QWEN_MODEL_ID;

        let qwenInput = [];
        let effectiveHistoryMessages = [];
        const limit = Number.parseInt(historyLimit, 10);
        if (!Number.isFinite(limit) || limit < 0) {
            return Response.json({ error: 'historyLimit invalid' }, { status: 400 });
        }
        const isRegenerateMode = mode === 'regenerate' && user && conversationId && Array.isArray(messages);
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
            const persisted = await persistRegenerateConversationMessages({
                conversationId,
                userId: user.userId,
                messages: sanitized,
            });
            const conv = persisted?.conversation;
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = sanitized;
            writePermitTime = persisted.writePermitTime;
        }

        const {
            currentConversationId,
            currentConversation,
            createdConversationForRequest,
            previousMessages,
            previousUpdatedAt,
        } = await ensureConversationForChatRequest({
            userId: user.userId,
            conversationId: conversationId || null,
            expectedProvider: 'qwen',
            prompt,
            fallbackTitle: prompt || 'New Chat',
            model,
            settings,
            webSearch: config?.webSearch,
        });

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            const historyBeforeCurrentPrompt = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === 'user'
                ? msgs.slice(0, -1)
                : msgs;
            effectiveHistoryMessages = (limit > 0 && Number.isFinite(limit))
                ? historyBeforeCurrentPrompt.slice(-limit)
                : historyBeforeCurrentPrompt;
            qwenInput = await buildResponsesInputFromHistory(effectiveMsgs, { providerStateKey: 'qwen' });
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? safeHistory.slice(-limit) : safeHistory;
            effectiveHistoryMessages = effectiveHistory;
            qwenInput = await buildResponsesInputFromHistory(effectiveHistory, { providerStateKey: 'qwen' });
        }

        if (!isRegenerateMode) {
            qwenInput.push({
                role: 'user',
                content: [{ type: 'input_text', text: prompt }],
            });
        }

        let maxTokens;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }

        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const baseInput = Array.isArray(qwenInput) ? qwenInput : [];
        const currentTurnInput = !isRegenerateMode && baseInput.length > 0
            ? baseInput[baseInput.length - 1]
            : null;
        const latestQwenResponseId = isRegenerateMode ? '' : findLatestQwenResponseId(effectiveHistoryMessages);

        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

        if (user && !isRegenerateMode) {
            const storedUserParts = [];
            if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });

            const enrichedStoredUserParts = await enrichConversationPartsWithBlobIds(storedUserParts, {
                userId: user.userId,
            });
            const userMessage = {
                id: resolvedUserMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: enrichedStoredUserParts
            };
            const persisted = await persistUserConversationMessage({
                conversationId: currentConversationId,
                userId: user.userId,
                userMessage,
            });
            const updatedConv = persisted?.conversation;
            if (!updatedConv) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }
            writePermitTime = persisted.writePermitTime;
        }

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch { }

        let paddingSent = false;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = '';
                let fullThought = '';
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
                        } catch { }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? SSE_PADDING : '';
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
                    const finalSystemPrompt = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const toolRecords = [];
                    const requestResponsesStream = async (requestBody, onThought, onText) => {
                        const request = async () => fetchWithZenmuxRateLimit(`${qwenBaseUrl}/responses`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({ ...requestBody, stream: true }),
                            signal: req?.signal,
                        }, {
                            label: `zenmux:qwen:${apiModel}`,
                        });

                        let response = await request();
                        if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                            await new Promise((resolve) => setTimeout(resolve, 800));
                            response = await request();
                        }
                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Qwen API Error: ${response.status} ${errorText}`);
                        }

                        return consumeStrictResponsesStream({
                            response,
                            signal: req?.signal,
                            onThoughtDelta: (text) => {
                                onThought?.(text);
                            },
                            onTextDelta: (text) => {
                                onText?.(text);
                            },
                            missingCompletedMessage: 'Qwen 上游缺少 response.completed 事件',
                        });
                    };

                    const usePreviousResponseId = Boolean(latestQwenResponseId && currentTurnInput);
                    let nextInput = usePreviousResponseId ? [currentTurnInput] : baseInput;
                    let previousResponseId = usePreviousResponseId ? latestQwenResponseId : '';
                    let finalPayload = null;
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const requestBody = {
                            model: apiModel,
                            stream: false,
                            max_output_tokens: maxTokens,
                            store: true,
                            enable_thinking: true,
                            reasoning: { effort: 'high' },
                            instructions: finalSystemPrompt,
                            input: nextInput,
                        };
                        if (previousResponseId) {
                            requestBody.previous_response_id = previousResponseId;
                        }
                        if (enableWebSearch && availableToolApiNames.length > 0) {
                            requestBody.tools = getOpenAIWebTools(availableToolApiNames);
                        }

                        const payload = await requestResponsesStream(requestBody, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (clientAborted) break;

                        const thought = extractOpenAIResponseReasoning(payload);
                        if (thought) {
                            fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                        }

                        const functionCalls = enableWebSearch ? extractOpenAIFunctionCalls(payload) : [];
                        if (functionCalls.length === 0) {
                            finalPayload = payload;
                            fullText = extractOpenAIResponseText(payload);
                            break;
                        }

                        previousResponseId = typeof payload?.id === 'string' ? payload.id : previousResponseId;
                        nextInput = [];

                        const selectedFunctionCalls = [];
                        const selectedFunctionCallRounds = [];
                        for (const functionCall of functionCalls.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)) {
                            const toolReservation = roundController?.reserve(functionCall.name);
                            if (!toolReservation?.allowed) continue;
                            selectedFunctionCalls.push(functionCall);
                            selectedFunctionCallRounds.push(toolReservation.round);
                        }
                        if (selectedFunctionCalls.length === 0) {
                            break;
                        }

                        for (let functionCallIndex = 0; functionCallIndex < selectedFunctionCalls.length; functionCallIndex += 1) {
                            const functionCall = selectedFunctionCalls[functionCallIndex];
                            const toolExecution = await executeWebBrowsingNativeToolCall({
                                apiName: functionCall.name,
                                argumentsInput: functionCall.arguments,
                                runtime,
                                sendEvent,
                                pushCitations,
                                round: selectedFunctionCallRounds[functionCallIndex] || 1,
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

                    const shouldForceFinalAnswer = enableWebSearch
                        && !finalPayload
                        && !clientAborted
                        && previousResponseId
                        && Array.isArray(nextInput)
                        && nextInput.length > 0;

                    if (shouldForceFinalAnswer) {
                        const payload = await requestResponsesStream({
                            model: apiModel,
                            stream: false,
                            max_output_tokens: maxTokens,
                            store: true,
                            enable_thinking: true,
                            reasoning: { effort: 'high' },
                            instructions: buildForcedFinalAnswerInstructions(finalSystemPrompt),
                            input: nextInput,
                            previous_response_id: previousResponseId,
                        }, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (!clientAborted) {
                            const thought = extractOpenAIResponseReasoning(payload);
                            if (thought) {
                                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            }
                            finalPayload = payload;
                            fullText = extractOpenAIResponseText(payload);
                        }
                    }

                    if (!finalPayload && !clientAborted) {
                        throw new Error('Qwen 工具循环未返回最终答案');
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { }
                        return;
                    }

                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
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
                                    qwen: {
                                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                                        output: normalizeOpenAIOutputItems(finalPayload?.output),
                                    },
                                }
                                : null,
                        };
                        const persistedConversation = await Conversation.findOneAndUpdate(
                            buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                            {
                                $push: { messages: modelMessage },
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
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }
                    try { await rollbackCurrentTurn(); } catch { }
                    try {
                        const errorPayload = JSON.stringify({ type: 'stream_error', message: err?.message || 'Unknown error' });
                        const padding = !paddingSent ? SSE_PADDING : '';
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
                    } catch { }
                }
            }
        });

        return new Response(responseStream, { headers: buildSseResponseHeaders(currentConversationId) });

    } catch (error) {
        console.error('Qwen API Error:', {
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
            errorMessage = 'API configuration error. Please check your API keys.';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
