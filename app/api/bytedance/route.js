import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import {
    fetchImageAsBase64,
    injectCurrentTimeSystemReminder,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
} from '@/app/api/chat/utils';
import { buildBytedanceInputFromHistory } from '@/app/api/bytedance/bytedanceHelpers';
import {
    SEED_MODEL_ID,
    SEED_REASONING_LEVELS,
    isSeedModel,
    normalizeSeedModelId,
} from '@/app/lib/seedModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEED_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const SEED_API_TIMEOUT_MS = 1_800_000;
const SEED_MAX_RETRIES = 2;
const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;
const WEB_SEARCH_TOOL = {
    type: 'web_search',
    max_keyword: 2,
    limit: 8,
};
const VALID_SEED_REASONING_LEVELS = new Set(SEED_REASONING_LEVELS);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUpstreamSignal(req) {
    const timeoutSignal = AbortSignal.timeout(SEED_API_TIMEOUT_MS);
    if (req?.signal) {
        return AbortSignal.any([req.signal, timeoutSignal]);
    }
    return timeoutSignal;
}

function normalizeChunkText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item.text === 'string') return item.text;
            if (item && typeof item.content === 'string') return item.content;
            return '';
        }).join('');
    }
    if (value && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.content === 'string') return value.content;
    }
    return '';
}

function normalizeSearchQuery(raw) {
    if (typeof raw === 'string') {
        return raw.trim();
    }
    if (Array.isArray(raw)) {
        return raw
            .filter((item) => typeof item === 'string' && item.trim())
            .join(' ')
            .trim();
    }
    return '';
}

function extractSearchQueryFromAction(action) {
    if (!action || typeof action !== 'object') return '';
    return normalizeSearchQuery(
        action.query
        ?? action.keyword
        ?? action.keywords
        ?? action.search_query
    );
}

function isWebSearchOutputItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.type === 'string' && item.type.includes('web_search_call')) return true;
    return typeof item.id === 'string' && item.id.startsWith('ws_');
}

function normalizeCitation(annotation) {
    if (!annotation || typeof annotation !== 'object') return null;

    const url = annotation.url
        ?? annotation.uri
        ?? annotation?.source?.url
        ?? annotation?.url_citation?.url
        ?? annotation?.web_search_result?.url;
    const title = annotation.title
        ?? annotation?.source?.title
        ?? annotation?.url_citation?.title
        ?? annotation?.web_search_result?.title
        ?? url;
    const citedText = annotation.cited_text
        ?? annotation.quote
        ?? annotation.text
        ?? annotation?.url_citation?.text;

    if (!isNonEmptyString(url)) return null;

    const citation = {
        url,
        title: isNonEmptyString(title) ? title : url,
    };

    if (isNonEmptyString(citedText)) {
        citation.cited_text = citedText;
    }

    return citation;
}

function extractCitationsFromContent(content) {
    const items = Array.isArray(content) ? content : [];
    return items
        .flatMap((item) => Array.isArray(item?.annotations) ? item.annotations : [])
        .map(normalizeCitation)
        .filter(Boolean);
}

function extractCitationsFromOutputItem(item) {
    if (!item || typeof item !== 'object') return [];
    if (item.type !== 'message') return [];
    return extractCitationsFromContent(item.content);
}

function extractCitationsFromResponsePayload(payload) {
    const outputs = Array.isArray(payload?.output) ? payload.output : [];
    return outputs.flatMap((item) => extractCitationsFromOutputItem(item));
}

function pushUniqueCitations(target, items) {
    if (!Array.isArray(target) || !Array.isArray(items)) return;
    for (const item of items) {
        if (!item?.url) continue;
        if (!target.some((citation) => citation.url === item.url)) {
            target.push(item);
        }
    }
}

function buildSeedRequestBody({
    model,
    input,
    instructions,
    maxTokens,
    thinkingLevel,
    enableWebSearch,
}) {
    const normalizedThinkingLevel = typeof thinkingLevel === 'string'
        ? thinkingLevel.trim().toLowerCase()
        : '';

    const requestBody = {
        model,
        stream: true,
        input,
        instructions,
        temperature: 1,
        top_p: 0.95,
    };

    if (Number.isFinite(maxTokens) && maxTokens > 0) {
        requestBody.max_output_tokens = maxTokens;
    }

    if (normalizedThinkingLevel === 'minimal') {
        requestBody.thinking = { type: 'disabled' };
    } else {
        requestBody.thinking = { type: 'enabled' };
        requestBody.reasoning = {
            effort: VALID_SEED_REASONING_LEVELS.has(normalizedThinkingLevel)
                ? normalizedThinkingLevel
                : 'medium',
        };
    }

    if (enableWebSearch) {
        requestBody.tools = [WEB_SEARCH_TOOL];
        requestBody.max_tool_calls = 3;
    }

    return requestBody;
}

async function requestSeedResponses({ apiKey, requestBody, req }) {
    const url = `${SEED_API_BASE_URL}/responses`;

    for (let attempt = 0; attempt < SEED_MAX_RETRIES; attempt += 1) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: createUpstreamSignal(req),
            });

            if (response.ok) {
                return response;
            }

            const errorText = await response.text();
            const shouldRetry = response.status >= 500 && attempt < SEED_MAX_RETRIES - 1;

            if (shouldRetry) {
                await sleep(800 * (attempt + 1));
                continue;
            }

            const error = new Error(`Seed 官方接口请求失败（${response.status}）：${errorText}`);
            error.status = response.status;
            throw error;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            if (attempt >= SEED_MAX_RETRIES - 1) {
                throw error;
            }
            await sleep(800 * (attempt + 1));
        }
    }

    throw new Error('Seed 官方接口请求失败');
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
            settings,
            userMessageId,
            modelMessageId,
        } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (!prompt || typeof prompt !== 'string') {
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

        const apiModel = normalizeSeedModelId(model);
        if (!isSeedModel(apiModel)) {
            return Response.json({ error: '当前接口仅支持官方 Seed 模型' }, { status: 400 });
        }

        let currentConversationId = conversationId;
        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? `${prompt.substring(0, 30)}...` : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title,
                model: apiModel,
                settings,
                messages: [],
            });
            currentConversationId = newConv._id.toString();
        }

        let seedInput = [];
        const limit = Number.parseInt(historyLimit, 10);
        const isRegenerateMode = mode === 'regenerate' && user && currentConversationId && Array.isArray(messages);
        let storedMessagesForRegenerate = null;

        if (isRegenerateMode) {
            let sanitized;
            try {
                sanitized = sanitizeStoredMessagesStrict(messages);
            } catch (error) {
                return Response.json({ error: error?.message || 'messages invalid' }, { status: 400 });
            }

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
            seedInput = await buildBytedanceInputFromHistory(effectiveMessages);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit))
                ? safeHistory.slice(-limit)
                : safeHistory;
            seedInput = await buildBytedanceInputFromHistory(effectiveHistory);
        }

        const dbImageEntries = [];
        if (!isRegenerateMode) {
            const userContent = [{ type: 'input_text', text: prompt }];

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

            seedInput.push({ role: 'user', content: userContent });
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

            const userMsgTime = Date.now();
            const userMessage = {
                id: userMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: storedUserParts,
            };

            const updatedConv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                {
                    $push: { messages: userMessage },
                    updatedAt: userMsgTime,
                },
                { new: true }
            ).select('updatedAt');

            writePermitTime = updatedConv?.updatedAt?.getTime?.();
        }

        const maxTokens = Number.parseInt(config?.maxTokens, 10);
        const thinkingLevel = typeof config?.thinkingLevel === 'string'
            ? config.thinkingLevel
            : 'medium';
        const enableWebSearch = config?.webSearch === true;
        const baseSystemPrompt = await injectCurrentTimeSystemReminder(
            typeof config?.systemPrompt === 'string' ? config.systemPrompt : ''
        );
        const formattingGuard = 'Output formatting rules: Do not use Markdown horizontal rules or standalone lines of \'---\'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.';
        const webSearchGuard = enableWebSearch
            ? 'If you use web search, answer naturally and do not append raw source URLs or bare domains in parentheses.'
            : '';
        const instructions = [baseSystemPrompt, formattingGuard, webSearchGuard]
            .filter((item) => typeof item === 'string' && item.trim())
            .join('\n\n');

        const requestBody = buildSeedRequestBody({
            model: apiModel || SEED_MODEL_ID,
            input: seedInput,
            instructions,
            maxTokens,
            thinkingLevel,
            enableWebSearch,
        });

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
                let searchInProgress = false;
                let activeSearchQuery = '';

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
                            const text = normalizeChunkText(event?.delta);
                            if (!text) return;
                            fullText += text;
                            sendEvent({ type: 'text', content: text });
                            return;
                        }

                        if (eventType === 'response.reasoning.delta' || eventType === 'response.reasoning_summary_text.delta') {
                            const thought = normalizeChunkText(event?.delta);
                            if (!thought) return;
                            fullThought += thought;
                            sendEvent({ type: 'thought', content: thought });
                            return;
                        }

                        if (eventType.includes('web_search_call') && eventType.includes('in_progress')) {
                            const nextQuery = extractSearchQueryFromAction(event?.item?.action || event?.action);
                            if (nextQuery) {
                                activeSearchQuery = nextQuery;
                            }
                            if (!searchInProgress) {
                                searchInProgress = true;
                                sendEvent({
                                    type: 'search_start',
                                    ...(activeSearchQuery ? { query: activeSearchQuery } : {}),
                                });
                            }
                            return;
                        }

                        if (eventType === 'response.output_item.done') {
                            const item = event?.item;
                            pushUniqueCitations(citations, extractCitationsFromOutputItem(item));

                            if (!isWebSearchOutputItem(item)) {
                                return;
                            }

                            const nextQuery = extractSearchQueryFromAction(item?.action) || activeSearchQuery;
                            if (!searchInProgress) {
                                searchInProgress = true;
                                sendEvent({
                                    type: 'search_start',
                                    ...(nextQuery ? { query: nextQuery } : {}),
                                });
                            }

                            sendEvent({
                                type: 'search_result',
                                ...(nextQuery ? { query: nextQuery } : {}),
                                results: [],
                            });

                            searchInProgress = false;
                            activeSearchQuery = '';
                            return;
                        }

                        if (eventType === 'response.completed') {
                            pushUniqueCitations(citations, extractCitationsFromResponsePayload(event?.response));
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
                        try { controller.close(); } catch { }
                        return;
                    }

                    if (searchInProgress) {
                        sendEvent({
                            type: 'search_result',
                            ...(activeSearchQuery ? { query: activeSearchQuery } : {}),
                            results: [],
                        });
                    }

                    if (citations.length > 0) {
                        sendEvent({ type: 'citations', citations });
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (user && currentConversationId) {
                        const writeCondition = writePermitTime
                            ? { _id: currentConversationId, userId: user.userId, updatedAt: { $lte: new Date(writePermitTime) } }
                            : { _id: currentConversationId, userId: user.userId };

                        const modelMessage = {
                            id: modelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            type: 'text',
                            parts: [{ text: fullText }],
                        };

                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            {
                                $push: { messages: modelMessage },
                                updatedAt: Date.now(),
                            }
                        );
                    }

                    controller.close();
                } catch (error) {
                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

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
