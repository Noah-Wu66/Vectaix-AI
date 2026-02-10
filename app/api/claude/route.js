import Anthropic from "@anthropic-ai/sdk";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptMessage, encryptMessages, encryptString } from '@/lib/encryption';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessages,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens
} from '@/app/api/chat/utils';
import {
    metasoSearch,
    buildMetasoContext,
    metasoReader,
    buildMetasoReaderContext,
    buildMetasoCitations,
    buildMetasoSearchEventResults
} from '@/app/api/chat/metasoSearch';
import { BASE_SYSTEM_PROMPT_TEXT } from '@/app/api/chat/systemPrompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };

async function storedPartToClaudePart(part) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        return { type: 'text', text: part.text };
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType;
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
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;

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

function extractJsonObject(text) {
    if (typeof text !== 'string') return null;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    return text.slice(first, last + 1);
}

function parseJsonFromText(text) {
    const jsonText = extractJsonObject(text);
    if (!jsonText) return null;
    try {
        return JSON.parse(jsonText);
    } catch {
        return null;
    }
}

export async function POST(req) {
    let writePermitTime = null;

    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
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
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        let currentConversationId = conversationId;

        const client = new Anthropic({
            apiKey: process.env.RIGHTCODE_API_KEY,
            baseURL: "https://www.right.codes/claude-aws",
            defaultHeaders: {
                "anthropic-beta": "extended-cache-ttl-2025-04-11"
            }
        });

        // 创建新会话
        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: encryptString(title),
                model: model,
                settings: settings,
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
                { $set: { messages: encryptMessages(sanitized), updatedAt: regenerateTime } },
                { new: true }
            ).select('messages updatedAt');
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = sanitized;
            writePermitTime = conv.updatedAt?.getTime?.();
        }

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveMsgs);
        } else {
            // 非 regenerate 模式：历史消息也需要正确处理图片
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveHistory);
        }

        // 在历史消息的最后一条添加缓存控制，使对话历史可被缓存
        if (claudeMessages.length > 0) {
            const lastHistoryMsg = claudeMessages[claudeMessages.length - 1];
            if (lastHistoryMsg.content?.length > 0) {
                const lastContent = lastHistoryMsg.content[lastHistoryMsg.content.length - 1];
                lastContent.cache_control = { type: "ephemeral", ttl: "1h" };
            }
        }

        let dbImageMimeType = null;
        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [{ type: 'text', text: prompt }];

            // 支持多张图片
            if (config?.images?.length > 0) {
                for (const img of config.images) {
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
                if (dbImageEntries.length > 0) {
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
                            mimeType: entry.mimeType,
                            url: entry.url,
                        },
                    });
                }
            }

            const userMsgTime = Date.now();
            const resolvedUserMessageId = userMessageId;
            const encryptedUserMessage = encryptMessage({
                id: resolvedUserMessageId,
                role: 'user',
                content: prompt,
                type: 'text',
                images: dbImageEntries.map(e => e.url),
                ...(dbImageMimeType ? { mimeType: dbImageMimeType } : {}),
                parts: storedUserParts
            });
            const updatedConv = await Conversation.findOneAndUpdate({ _id: currentConversationId, userId: user.userId }, {
                $push: {
                    messages: encryptedUserMessage
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.();
        }

        // 构建请求参数（联网检索上下文将在流式开始前注入）
        const maxTokens = config?.maxTokens;
        const budgetTokens = config?.budgetTokens;
        const thinkingLevel = config?.thinkingLevel;
        const isOpus = typeof model === "string" && model.startsWith("claude-opus-4-6");
        const baseSystemPromptText = BASE_SYSTEM_PROMPT_TEXT;
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        // 是否启用联网搜索
        const enableWebSearch = config?.webSearch === true;

        // 联网搜索时禁用来源括号标注
        const webSearchGuide = enableWebSearch
            ? "\n\nDo not add source domains or URLs in parentheses in your reply."
            : "";

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
                let citations = [];

                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch { /* ignore */ }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        const data = `data: ${JSON.stringify(payload)}${padding}\n\n`;
                        controller.enqueue(encoder.encode(data));
                    };

                    let searchErrorSent = false;
                    const sendSearchError = (message) => {
                        if (searchErrorSent) return;
                        searchErrorSent = true;
                        sendEvent({ type: 'search_error', message });
                    };

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url) continue;
                            if (!citations.some(c => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title, cited_text: null });
                            }
                        }
                    };

                    const runDecisionStream = async (systemText, userText) => {
                        let decisionText = "";
                        const decisionStream = await client.messages.stream({
                            model: model,
                            max_tokens: 512,
                            system: [
                                {
                                    type: "text",
                                    text: systemText,
                                    cache_control: { type: "ephemeral", ttl: "1h" }
                                }
                            ],
                            messages: [
                                { role: 'user', content: [{ type: 'text', text: userText }] }
                            ],
                            stream: true,
                            ...(isOpus
                                ? { thinking: { type: "adaptive" }, output_config: { effort: "low" } }
                                : { thinking: { type: "enabled", budget_tokens: 1024 } }
                            )
                        });

                        for await (const event of decisionStream) {
                            if (clientAborted) break;
                            if (event.type === 'content_block_delta') {
                                const delta = event.delta;
                                if (delta.type === 'thinking_delta') {
                                    fullThought += delta.thinking;
                                    sendEvent({ type: 'thought', content: delta.thinking });
                                } else if (delta.type === 'text_delta') {
                                    decisionText += delta.text;
                                }
                            }
                        }

                        return decisionText;
                    };

                    let searchContextText = "";
                    if (enableWebSearch && !clientAborted) {
                        const decisionSystem = injectCurrentTimeSystemReminder(
                            "你是联网检索决策器。必须只输出严格 JSON，不要输出任何多余文本。"
                        );
                        const decisionUser = `用户问题：${prompt}\n\n判断是否必须联网检索才能回答。\n- 需要联网：输出 {"needSearch": true, "query": "精炼检索词"}\n- 不需要联网：输出 {"needSearch": false}`;
                        const decisionText = await runDecisionStream(decisionSystem, decisionUser);
                        const decision = parseJsonFromText(decisionText);
                        let needSearch = decision?.needSearch === true;
                        let nextQuery = typeof decision?.query === 'string' ? decision.query.trim() : "";
                        console.info("Claude web search decision", {
                            needSearch,
                            hasQuery: Boolean(nextQuery),
                            model,
                            conversationId: currentConversationId
                        });

                        const searchContextParts = [];
                        const readUrlSet = new Set();
                        const MAX_READ_PAGES = 10;
                        const maxSearchRounds = 10;
                        for (let round = 0; round < maxSearchRounds && needSearch && nextQuery; round++) {
                            if (clientAborted) break;
                            sendEvent({ type: 'search_start', query: nextQuery });
                            let results = [];
                            let searchFailed = false;
                            try {
                                const searchData = await metasoSearch(nextQuery, {
                                    scope: "webpage",
                                    includeSummary: false,
                                    size: 100,
                                    includeRawContent: false,
                                    conciseSnippet: true
                                });
                                results = searchData?.results;
                            } catch (searchError) {
                                console.error("Claude web search failed", {
                                    query: nextQuery,
                                    message: searchError?.message,
                                    name: searchError?.name
                                });
                                const msg = searchError?.message?.includes("METASO_API_KEY")
                                    ? "未配置搜索服务"
                                    : "检索失败，请稍后再试";
                                sendSearchError(msg);
                                searchFailed = true;
                            }

                            if (searchFailed) break;

                            if (!Array.isArray(results) || results.length === 0) {
                                console.warn("Claude web search empty results", {
                                    query: nextQuery,
                                    round: round + 1
                                });
                            }

                            const eventResults = buildMetasoSearchEventResults(results);
                            sendEvent({ type: 'search_result', query: nextQuery, results: eventResults });
                            pushCitations(buildMetasoCitations(results));

                            const roundContextBlocks = [];
                            const contextBlock = buildMetasoContext(results);
                            if (contextBlock) {
                                roundContextBlocks.push(contextBlock);
                            }

                            const readerCandidates = Array.isArray(results) ? results.slice(0, 8) : [];
                            if (readerCandidates.length > 0 && readUrlSet.size < MAX_READ_PAGES) {
                                try {
                                    const readerSystem = injectCurrentTimeSystemReminder(
                                        "你是网页全文查看决策器。必须只输出严格 JSON，不要输出任何多余文本。"
                                    );
                                    const remainingQuota = MAX_READ_PAGES - readUrlSet.size;
                                    const candidateText = readerCandidates
                                        .map((item, idx) => {
                                            const title = typeof item?.title === 'string' ? item.title : '';
                                            const url = typeof item?.url === 'string' ? item.url : '';
                                            const rawSnippet = typeof item?.snippet === 'string' && item.snippet.trim()
                                                ? item.snippet.trim()
                                                : (typeof item?.summary === 'string' ? item.summary.trim() : '');
                                            const snippet = rawSnippet.length > 240 ? `${rawSnippet.slice(0, 240)}...` : rawSnippet;
                                            return `[${idx + 1}] ${title}\nURL: ${url}\n片段: ${snippet || '（无）'}`;
                                        })
                                        .join("\n\n");
                                    const alreadyRead = Array.from(readUrlSet);
                                    const readerUser = `用户问题：${prompt}\n当前检索词：${nextQuery}\n\n候选结果：\n${candidateText}\n\n已查看过的 URL：\n${alreadyRead.length > 0 ? alreadyRead.join("\n") : "无"}\n\n剩余可查看配额：${remainingQuota} 个网页\n\n判断是否需要查看网页正文来提升答案质量。可以同时选择多个网页（不超过剩余配额）。\n- 需要：输出 {"needRead": true, "urls": ["候选URL1", "候选URL2", ...]}\n- 不需要：输出 {"needRead": false}`;
                                    const readerDecisionText = await runDecisionStream(readerSystem, readerUser);
                                    const readerDecision = parseJsonFromText(readerDecisionText);
                                    const shouldRead = readerDecision?.needRead === true;
                                    const selectedUrls = Array.isArray(readerDecision?.urls)
                                        ? readerDecision.urls.map(u => typeof u === 'string' ? u.trim() : '').filter(Boolean)
                                        : [];

                                    if (shouldRead && selectedUrls.length > 0) {
                                        for (const selectedUrl of selectedUrls) {
                                            if (readUrlSet.size >= MAX_READ_PAGES) break;
                                            if (readUrlSet.has(selectedUrl)) continue;
                                            const selectedItem = readerCandidates.find((item) => item?.url === selectedUrl);
                                            if (!selectedItem) continue;
                                            sendEvent({ type: 'search_reader_start', url: selectedItem.url, title: selectedItem.title });
                                            try {
                                                const readerData = await metasoReader(selectedItem.url, { timeoutMs: 20000 });
                                                const readerContext = buildMetasoReaderContext(
                                                    {
                                                        title: selectedItem.title,
                                                        url: selectedItem.url,
                                                        content: readerData?.content,
                                                    },
                                                    { maxContentChars: 10000 }
                                                );
                                                if (readerContext) {
                                                    const readerExcerpt = typeof readerData?.content === 'string'
                                                        ? readerData.content.slice(0, 800)
                                                        : "";
                                                    roundContextBlocks.push(readerContext);
                                                    readUrlSet.add(selectedItem.url);
                                                    sendEvent({
                                                        type: 'search_reader_result',
                                                        url: selectedItem.url,
                                                        title: selectedItem.title,
                                                        excerpt: readerExcerpt
                                                    });
                                                }
                                            } catch (readerError) {
                                                console.error("Claude web reader failed", {
                                                    url: selectedItem.url,
                                                    message: readerError?.message,
                                                    name: readerError?.name
                                                });
                                                sendEvent({ type: 'search_reader_error', url: selectedItem.url, title: selectedItem.title });
                                            }
                                        }
                                    }
                                } catch (readerDecisionError) {
                                    console.error("Claude web reader decision failed", {
                                        query: nextQuery,
                                        message: readerDecisionError?.message,
                                        name: readerDecisionError?.name
                                    });
                                }
                            }

                            if (roundContextBlocks.length > 0) {
                                searchContextParts.push(`检索词: ${nextQuery}\n${roundContextBlocks.join("\n\n")}`);
                            }

                            if (round === maxSearchRounds - 1) break;

                            const recentContext = searchContextParts.slice(-2).join("\n\n");
                            const enoughSystem = injectCurrentTimeSystemReminder(
                                "你是联网检索补充决策器。必须只输出严格 JSON，不要输出任何多余文本。"
                            );
                            const enoughUser = `用户问题：${prompt}\n\n已获得的检索摘要：\n${recentContext}\n\n判断这些信息是否足够回答。\n- 足够：输出 {"enough": true}\n- 不足：输出 {"enough": false, "nextQuery": "新的检索词"}`;
                            const enoughText = await runDecisionStream(enoughSystem, enoughUser);
                            const enoughDecision = parseJsonFromText(enoughText);
                            if (enoughDecision?.enough === true) break;
                            const candidateQuery = typeof enoughDecision?.nextQuery === 'string'
                                ? enoughDecision.nextQuery.trim()
                                : "";
                            if (!candidateQuery || candidateQuery === nextQuery) break;
                            nextQuery = candidateQuery;
                        }

                        searchContextText = searchContextParts.join("\n\n");
                        if (!searchContextText) {
                            console.warn("Claude web search produced no context", {
                                needSearch,
                                lastQuery: nextQuery,
                                rounds: searchContextParts.length
                            });
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    const searchContextSection = searchContextText
                        ? buildWebSearchContextBlock(searchContextText)
                        : "";
                    if (searchContextSection) {
                        sendEvent({ type: 'search_context_tokens', tokens: estimateTokens(searchContextSection) });
                    }
                    const systemPrompt = injectCurrentTimeSystemReminder(
                        `${baseSystemPromptText}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`
                    );
                    const requestParams = {
                        model: model,
                        max_tokens: maxTokens,
                        system: [
                            {
                                type: "text",
                                text: systemPrompt,
                                cache_control: {
                                    type: "ephemeral",
                                    ttl: "1h"
                                }
                            }
                        ],
                        messages: claudeMessages,
                        stream: true,
                        ...(isOpus
                            ? {
                                thinking: { type: "adaptive" },
                                output_config: {
                                    effort: (() => {
                                        const allowed = new Set(["low", "medium", "high", "max"]);
                                        if (typeof thinkingLevel === "string" && allowed.has(thinkingLevel)) {
                                            return thinkingLevel;
                                        }
                                        return "high";
                                    })()
                                }
                            }
                            : {
                                thinking: { type: "enabled", budget_tokens: budgetTokens }
                            }
                        )
                    };

                    const stream = await client.messages.stream(requestParams);

                    for await (const event of stream) {
                        if (clientAborted) break;

                        if (event.type === 'content_block_delta') {
                            const delta = event.delta;
                            if (delta.type === 'thinking_delta') {
                                fullThought += delta.thinking;
                                sendEvent({ type: 'thought', content: delta.thinking });
                            } else if (delta.type === 'text_delta') {
                                fullText += delta.text;
                                const citationData = Array.isArray(delta.citations) ? delta.citations : [];
                                if (citationData.length > 0) {
                                    for (const c of citationData) {
                                        if (c?.type === 'web_search_result_location') {
                                            const exists = citations.some(
                                                existing => existing.url === c.url && existing.cited_text === c.cited_text
                                            );
                                            if (!exists) {
                                                citations.push({
                                                    url: c.url,
                                                    title: c.title,
                                                    cited_text: c.cited_text
                                                });
                                            }
                                        }
                                    }
                                }
                                sendEvent({ type: 'text', content: delta.text });
                            }
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    // 发送引用信息
                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (user && currentConversationId) {
                        const writeCondition = writePermitTime
                            ? { _id: currentConversationId, userId: user.userId, updatedAt: { $lte: new Date(writePermitTime) } }
                            : { _id: currentConversationId, userId: user.userId };
                        const resolvedModelMessageId = (isNonEmptyString(modelMessageId) && modelMessageId.length <= 128)
                            ? modelMessageId
                            : generateMessageId();
                        const encryptedModelMessage = encryptMessage({
                            id: resolvedModelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            type: 'text',
                            parts: [{ text: fullText }]
                        });
                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            {
                                $push: {
                                    messages: encryptedModelMessage
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
                    // 将错误作为 SSE 事件发送给客户端（而非 controller.error），保留原始错误信息
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
            name: error?.name,
            code: error?.code
        });

        const status = typeof error?.status === 'number' ? error.status : 500;
        let errorMessage = error?.message;

        if (error?.message?.includes('API_KEY')) {
            errorMessage = "API configuration error. Please check your API keys.";
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
