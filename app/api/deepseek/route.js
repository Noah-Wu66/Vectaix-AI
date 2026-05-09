import Conversation from '@/models/Conversation';
import {
    fetchImageAsBase64,
    generateMessageId,
    getStoredPartsFromMessage,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
    estimateTokens,
} from '@/app/api/chat/utils';
import { DEEPSEEK_V4_PRO_MODEL } from '@/lib/shared/models';
import { resolveDeepSeekProviderConfig } from '@/lib/modelRoutes';
import {
    buildDirectChatSystemPrompt,
    buildForcedFinalAnswerInstructions,
} from '@/lib/server/chat/systemPromptBuilder';
import {
    clampMaxTokens,
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
import {
    buildSseResponseHeaders,
    ensureConversationForChatRequest,
    persistRegenerateConversationMessages,
    persistUserConversationMessage,
    requireChatUser,
    validateChatRequestBody,
} from '@/lib/server/chat/routeHelpers';
import { assertRequestSize, parseJsonRequest } from '@/lib/server/api/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildDeepSeekTraceId() {
    return `deepseek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractDeepSeekContentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
        })
        .join('');
}

function responseContentToChatContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    const parts = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if (typeof part.text === 'string') {
            parts.push({ type: 'text', text: part.text });
            continue;
        }
        if (typeof part.image_url === 'string' && part.image_url) {
            parts.push({ type: 'image_url', image_url: { url: part.image_url } });
        }
    }

    if (parts.length === 0) return '';
    if (parts.every((part) => part.type === 'text')) {
        return parts.map((part) => part.text).join('\n');
    }
    return parts;
}

function responseInputItemToChatMessage(item) {
    if (!item || typeof item !== 'object') return null;

    if (item.type === 'function_call_output') {
        const toolCallId = typeof item.call_id === 'string' ? item.call_id : '';
        const content = typeof item.output === 'string' ? item.output : JSON.stringify(item.output || {});
        if (!toolCallId) return null;
        return { role: 'tool', tool_call_id: toolCallId, content };
    }

    if (item.type === 'message' || item.role) {
        const role = item.role === 'model' ? 'assistant' : item.role;
        if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') return null;
        const message = {
            role,
            content: responseContentToChatContent(item.content),
        };
        if (role === 'assistant' && typeof item.reasoning_content === 'string' && item.reasoning_content) {
            message.reasoning_content = item.reasoning_content;
        }
        if (role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
            message.tool_calls = item.tool_calls;
        }
        if (role === 'tool' && typeof item.tool_call_id === 'string') {
            message.tool_call_id = item.tool_call_id;
        }
        return message.content || message.tool_calls ? message : null;
    }

    if (item.type === 'output_text' || item.type === 'text') {
        const text = typeof item.text === 'string' ? item.text : '';
        return text ? { role: 'assistant', content: text } : null;
    }

    return null;
}

async function storedPartToDeepSeekContent(part, role) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        return { type: 'text', text: part.text };
    }

    if (role !== 'assistant') {
        const url = part?.inlineData?.url;
        if (isNonEmptyString(url)) {
            const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
            const mimeType = part.inlineData?.mimeType || fetchedMimeType;
            return {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
            };
        }
    }

    return null;
}

async function buildDeepSeekMessagesFromHistory(messages) {
    const output = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        if (msg.role === 'model') {
            const providerOutput = Array.isArray(msg?.providerState?.deepseek?.output)
                ? msg.providerState.deepseek.output
                : [];
            if (providerOutput.length > 0) {
                for (const item of providerOutput) {
                    const providerMessage = responseInputItemToChatMessage(item);
                    if (providerMessage) output.push(providerMessage);
                }
                continue;
            }
        }

        const role = msg.role === 'model' ? 'assistant' : 'user';
        const contentParts = [];
        const storedParts = getStoredPartsFromMessage(msg);
        for (const storedPart of storedParts) {
            const part = await storedPartToDeepSeekContent(storedPart, role);
            if (part) contentParts.push(part);
        }

        if (contentParts.length === 0 && isNonEmptyString(msg.content)) {
            contentParts.push({ type: 'text', text: msg.content });
        }

        if (contentParts.length > 0) {
            output.push({
                role,
                content: contentParts.every((part) => part.type === 'text')
                    ? contentParts.map((part) => part.text).join('\n')
                    : contentParts,
            });
        }
    }
    return output;
}

function getDeepSeekChatTools(apiNames) {
    return getOpenAIWebTools(apiNames).map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

function normalizeDeepSeekToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls
        .map((toolCall, index) => {
            const id = typeof toolCall?.id === 'string' && toolCall.id
                ? toolCall.id
                : `call_${index}`;
            const name = typeof toolCall?.function?.name === 'string' ? toolCall.function.name : '';
            const args = typeof toolCall?.function?.arguments === 'string'
                ? toolCall.function.arguments
                : JSON.stringify(toolCall?.function?.arguments || {});
            if (!name) return null;
            return {
                id,
                type: 'function',
                function: {
                    name,
                    arguments: args,
                },
            };
        })
        .filter(Boolean);
}

function buildDeepSeekAssistantMessage(payload) {
    const message = {
        role: 'assistant',
        content: typeof payload?.content === 'string' ? payload.content : '',
    };
    if (typeof payload?.reasoning_content === 'string' && payload.reasoning_content) {
        message.reasoning_content = payload.reasoning_content;
    }
    const toolCalls = normalizeDeepSeekToolCalls(payload?.toolCalls);
    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
    }
    return message;
}

function extractDeepSeekFunctionCalls(payload) {
    return normalizeDeepSeekToolCalls(payload?.toolCalls).map((toolCall) => ({
        id: toolCall.id,
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
    }));
}

function buildDeepSeekProviderOutput({ content, reasoningContent }) {
    const item = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content || '' }],
    };
    if (reasoningContent) {
        item.reasoning_content = reasoningContent;
    }
    return [item];
}

async function consumeDeepSeekChatCompletionStream({
    response,
    signal,
    onEvent,
    onParseError,
    onDone,
    onThoughtDelta,
    onTextDelta,
}) {
    if (!response?.body?.getReader) {
        throw new Error('DeepSeek 上游缺少可读取的响应流');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoningContent = '';
    let id = '';
    let model = '';
    let usage = null;
    let finishReason = null;
    const toolCallsByIndex = new Map();

    const processPayload = (data) => {
        if (!data || data === '[DONE]') {
            onDone?.();
            return;
        }

        let event;
        try {
            event = JSON.parse(data);
        } catch {
            onParseError?.(data);
            return;
        }

        onEvent?.(event);
        if (typeof event?.id === 'string') id = event.id;
        if (typeof event?.model === 'string') model = event.model;
        if (event?.usage && typeof event.usage === 'object') usage = event.usage;

        const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
        if (!choice) return;
        if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;

        const delta = choice.delta || {};
        const reasoningDelta = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
        if (reasoningDelta) {
            reasoningContent += reasoningDelta;
            onThoughtDelta?.(reasoningDelta);
        }

        const textDelta = typeof delta.content === 'string' ? delta.content : '';
        if (textDelta) {
            content += textDelta;
            onTextDelta?.(textDelta);
        }

        if (Array.isArray(delta.tool_calls)) {
            for (const toolCallDelta of delta.tool_calls) {
                const index = Number.isInteger(toolCallDelta?.index) ? toolCallDelta.index : toolCallsByIndex.size;
                const existing = toolCallsByIndex.get(index) || {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                };
                if (typeof toolCallDelta.id === 'string') existing.id = toolCallDelta.id;
                if (typeof toolCallDelta.type === 'string') existing.type = toolCallDelta.type;
                if (typeof toolCallDelta?.function?.name === 'string') {
                    existing.function.name += toolCallDelta.function.name;
                }
                if (typeof toolCallDelta?.function?.arguments === 'string') {
                    existing.function.arguments += toolCallDelta.function.arguments;
                }
                toolCallsByIndex.set(index, existing);
            }
        }
    };

    while (true) {
        if (signal?.aborted) {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            throw error;
        }

        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            processPayload(trimmed.slice(5).trim());
        }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        processPayload(trimmed.slice(5).trim());
    }

    const toolCalls = Array.from(toolCallsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, toolCall]) => toolCall)
        .filter((toolCall) => toolCall?.function?.name);

    return {
        id,
        model,
        content,
        reasoning_content: reasoningContent,
        toolCalls,
        usage,
        choices: [{
            finish_reason: finishReason,
            message: {
                role: 'assistant',
                content,
                reasoning_content: reasoningContent,
                tool_calls: toolCalls.length > 0 ? toolCalls : null,
            },
        }],
    };
}

export async function POST(req) {
    let writePermitTime = null;
    const deepSeekTraceId = buildDeepSeekTraceId();

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

        const { baseUrl: deepseekBaseUrl, apiKey } = resolveDeepSeekProviderConfig();
        const apiModel = DEEPSEEK_V4_PRO_MODEL;

        let deepseekInput = [];
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
            expectedProvider: 'deepseek',
            prompt,
            fallbackTitle: prompt || 'New Chat',
            model,
            settings,
            webSearch: config?.webSearch,
        });

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            deepseekInput = await buildDeepSeekMessagesFromHistory(effectiveMsgs);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? safeHistory.slice(-limit) : safeHistory;
            deepseekInput = await buildDeepSeekMessagesFromHistory(effectiveHistory);
        }

        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [];
            if (isNonEmptyString(prompt)) {
                userContent.push({ type: 'text', text: prompt });
            }
            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${base64Data}` },
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
            }
            deepseekInput.push({
                role: 'user',
                content: userContent.every((part) => part.type === 'text')
                    ? userContent.map((part) => part.text).join('\n')
                    : userContent,
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
        const baseInput = Array.isArray(deepseekInput) ? deepseekInput : [];
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

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
        const onAbort = () => {
            clientAborted = true;
        };
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
                    const requestChatCompletionsStream = async (requestBody, onThought, onText) => {
                        const request = async () => fetch(`${deepseekBaseUrl}/chat/completions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({ ...requestBody, stream: true }),
                            signal: req?.signal,
                        });

                        let response = await request();
                        if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                            await new Promise((resolve) => setTimeout(resolve, 800));
                            response = await request();
                        }
                        if (!response.ok) {
                            const errorText = await response.text();
                            const error = new Error(`DeepSeek API Error: ${response.status} ${errorText}`);
                            error.status = response.status;
                            throw error;
                        }

                        return consumeDeepSeekChatCompletionStream({
                            response,
                            signal: req?.signal,
                            onThoughtDelta: (text) => {
                                onThought?.(text);
                            },
                            onTextDelta: (text) => {
                                onText?.(text);
                            },
                        });
                    };

                    let nextMessages = [
                        { role: 'system', content: finalSystemPrompt },
                        ...baseInput,
                    ];
                    let finalPayload = null;
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const requestBody = {
                            model: apiModel,
                            messages: nextMessages,
                            max_tokens: clampMaxTokens(maxTokens, 384000),
                            thinking: { type: 'enabled' },
                            reasoning_effort: 'max',
                        };
                        if (enableWebSearch && availableToolApiNames.length > 0) {
                            requestBody.tools = getDeepSeekChatTools(availableToolApiNames);
                        }

                        const payload = await requestChatCompletionsStream(requestBody, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (clientAborted) break;

                        const thought = typeof payload?.reasoning_content === 'string' ? payload.reasoning_content : '';
                        if (thought) {
                            fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                        }

                        const functionCalls = enableWebSearch ? extractDeepSeekFunctionCalls(payload) : [];
                        const passText = extractDeepSeekContentText(payload?.content);
                        if (functionCalls.length === 0) {
                            if (passText) {
                                finalPayload = payload;
                                fullText = passText;
                                break;
                            }
                            break;
                        }

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

                        nextMessages.push(buildDeepSeekAssistantMessage(payload));

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
                            nextMessages.push({
                                role: 'tool',
                                tool_call_id: functionCall.call_id,
                                content: toolExecution.outputText,
                            });
                        }
                    }

                    const shouldForceFinalAnswer = enableWebSearch
                        && !finalPayload
                        && !clientAborted
                        && Array.isArray(nextMessages)
                        && nextMessages.length > 1;

                    if (shouldForceFinalAnswer) {
                        const forcedMessages = [
                            {
                                role: 'system',
                                content: buildForcedFinalAnswerInstructions(finalSystemPrompt),
                            },
                            ...nextMessages.filter((message) => message?.role !== 'system'),
                        ];
                        const payload = await requestChatCompletionsStream({
                            model: apiModel,
                            messages: forcedMessages,
                            max_tokens: clampMaxTokens(maxTokens, 384000),
                            thinking: { type: 'enabled' },
                            reasoning_effort: 'max',
                        }, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (!clientAborted) {
                            const thought = typeof payload?.reasoning_content === 'string' ? payload.reasoning_content : '';
                            if (thought) {
                                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            }
                            finalPayload = payload;
                            fullText = extractDeepSeekContentText(payload?.content);
                        }
                    }

                    if (!finalPayload && !clientAborted) {
                        throw new Error('DeepSeek 工具循环未返回最终答案');
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

                    // 存储 AI 回复到数据库
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
                                    deepseek: {
                                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                                        output: buildDeepSeekProviderOutput({
                                            content: fullText,
                                            reasoningContent: fullThought,
                                        }),
                                    },
                                }
                                : null,
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
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }
                    console.error('[DeepSeek] Stream error:', {
                        traceId: deepSeekTraceId,
                        name: err?.name || '',
                        status: typeof err?.status === 'number' ? err.status : null,
                        code: err?.code || '',
                        finalMessagePersisted,
                        fullTextLength: fullText.length,
                        fullThoughtLength: fullThought.length,
                        citationCount: citations.length,
                        toolRecordCount: toolRecords.length,
                    });
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
        console.error('[DeepSeek] API error:', {
            traceId: deepSeekTraceId,
            status: error?.status,
            name: error?.name,
            code: error?.code
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const isUpstreamAuthError = rawStatus === 401;
        const status = isUpstreamAuthError ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (isUpstreamAuthError) {
            errorMessage = 'DeepSeek 接口认证失败，请检查 DEEPSEEK_API_KEY';
        } else if (error?.message?.includes('DEEPSEEK_API_KEY')) {
            errorMessage = 'DeepSeek 接口未正确配置，请检查 DEEPSEEK_API_KEY';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
