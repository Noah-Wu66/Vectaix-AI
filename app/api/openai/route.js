import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptMessage, encryptMessages, encryptString } from '@/lib/encryption';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    sanitizeStoredMessages,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock
} from '@/app/api/chat/utils';
import {
    metasoSearch,
    buildMetasoContext,
    metasoReader,
    buildMetasoReaderContext,
    buildMetasoCitations,
    buildMetasoSearchEventResults
} from '@/app/api/chat/metasoSearch';

import { buildOpenAIInputFromHistory, parseJsonFromText } from '@/app/api/openai/openaiHelpers';
import { BASE_SYSTEM_PROMPT_TEXT } from '@/app/api/chat/systemPrompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_BASE_URL = 'https://www.right.codes/codex/v1';
const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const DEFAULT_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
const MODEL_REASONING_EFFORTS = {
    'gpt-5.3-codex': new Set(['low', 'medium', 'high', 'xhigh']),
};



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

        let openaiInput = [];
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
            openaiInput = await buildOpenAIInputFromHistory(effectiveMsgs);
        } else {
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            openaiInput = await buildOpenAIInputFromHistory(effectiveHistory);
        }

        let dbImageMimeType = null;
        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [{ type: 'input_text', text: prompt }];

            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'input_image',
                            image_url: `data:${mimeType};base64,${base64Data}`
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
                if (dbImageEntries.length > 0) {
                    dbImageMimeType = dbImageEntries[0].mimeType;
                }
            }

            openaiInput.push({ role: 'user', content: userContent });
        }

        // 保存用户消息
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

        // 构建 Responses API 请求
        const maxTokens = config?.maxTokens;
        const thinkingLevel = config?.thinkingLevel;

        const baseSystemPromptText = BASE_SYSTEM_PROMPT_TEXT;
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        const baseSystemPrompt = injectCurrentTimeSystemReminder(
            `${baseSystemPromptText}\n\n${formattingGuard}`
        );
        const baseInputWithInstructions = [
            { role: 'developer', content: [{ type: 'input_text', text: baseSystemPrompt }] },
            ...(Array.isArray(openaiInput) ? openaiInput : [])
        ];

        const baseRequestBody = {
            model: model,
            stream: true,
            max_output_tokens: maxTokens,
            reasoning: {
                effort: "high",
                summary: "auto"
            }
        };

        // Map UI thinkingLevel to Responses API reasoning.effort
        const allowedEfforts = MODEL_REASONING_EFFORTS[model] || DEFAULT_REASONING_EFFORTS;
        if (allowedEfforts.has(thinkingLevel)) {
            baseRequestBody.reasoning.effort = thinkingLevel;
        }

        // 是否启用联网搜索
        const enableWebSearch = config?.webSearch === true;
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
                                citations.push({ url: item.url, title: item.title });
                            }
                        }
                    };

                    const runDecisionStream = async (systemText, userText) => {
                        let decisionText = "";
                        const decisionBody = {
                            ...baseRequestBody,
                            input: [
                                { role: 'developer', content: [{ type: 'input_text', text: systemText }] },
                                { role: 'user', content: [{ type: 'input_text', text: userText }] }
                            ],
                            max_output_tokens: 512,
                            reasoning: {
                                effort: "low",
                                summary: "auto"
                            }
                        };

                        const decisionResponse = await fetch(`${OPENAI_BASE_URL}/responses`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${process.env.RIGHTCODE_API_KEY}`
                            },
                            body: JSON.stringify(decisionBody)
                        });

                        if (!decisionResponse.ok) {
                            const errorText = await decisionResponse.text();
                            throw new Error(`OpenAI decision error: ${decisionResponse.status} ${errorText}`);
                        }

                        const reader = decisionResponse.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = "";

                        while (true) {
                            const { value, done } = await reader.read();
                            if (done || clientAborted) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop();

                            for (const line of lines) {
                                if (!line.trim() || line.startsWith(':')) continue;
                                if (!line.startsWith('data: ')) continue;

                                const dataStr = line.slice(6);
                                if (dataStr === '[DONE]') continue;

                                try {
                                    const event = JSON.parse(dataStr);
                                    if (event.type === 'response.reasoning.delta') {
                                        const thought = event.delta;
                                        fullThought += thought;
                                        sendEvent({ type: 'thought', content: thought });
                                    } else if (event.type === 'response.output_text.delta') {
                                        decisionText += event.delta;
                                    }
                                } catch { /* ignore parse errors */ }
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

                        const searchContextParts = [];
                        const readUrlSet = new Set();
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
                                console.error("OpenAI web search failed", {
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

                            const eventResults = buildMetasoSearchEventResults(results);
                            sendEvent({ type: 'search_result', query: nextQuery, results: eventResults });
                            pushCitations(buildMetasoCitations(results));

                            const roundContextBlocks = [];
                            const contextBlock = buildMetasoContext(results);
                            if (contextBlock) {
                                roundContextBlocks.push(contextBlock);
                            }

                            const readerCandidates = Array.isArray(results) ? results.slice(0, 8) : [];
                            if (readerCandidates.length > 0) {
                                try {
                                    const readerSystem = injectCurrentTimeSystemReminder(
                                        "你是网页全文查看决策器。必须只输出严格 JSON，不要输出任何多余文本。"
                                    );
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
                                    const readerUser = `用户问题：${prompt}\n当前检索词：${nextQuery}\n\n候选结果：\n${candidateText}\n\n已查看过的 URL：\n${alreadyRead.length > 0 ? alreadyRead.join("\n") : "无"}\n\n判断是否需要查看更多正文来提升答案质量。\n- 需要：输出 {"needRead": true, "url": "候选URL"}\n- 不需要：输出 {"needRead": false}`;
                                    const readerDecisionText = await runDecisionStream(readerSystem, readerUser);
                                    const readerDecision = parseJsonFromText(readerDecisionText);
                                    const selectedUrl = typeof readerDecision?.url === 'string'
                                        ? readerDecision.url.trim()
                                        : '';
                                    const shouldRead = readerDecision?.needRead === true;
                                    const selectedItem = readerCandidates.find((item) => item?.url === selectedUrl);

                                    if (shouldRead && selectedItem && !readUrlSet.has(selectedItem.url)) {
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
                                            console.error("OpenAI web reader failed", {
                                                url: selectedItem.url,
                                                message: readerError?.message,
                                                name: readerError?.name
                                            });
                                            sendEvent({ type: 'search_reader_error', url: selectedItem.url, title: selectedItem.title });
                                        }
                                    }
                                } catch (readerDecisionError) {
                                    console.error("OpenAI web reader decision failed", {
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
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    const searchContextSection = searchContextText
                        ? buildWebSearchContextBlock(searchContextText)
                        : "";
                    const finalSystemPrompt = `${baseSystemPrompt}${webSearchGuide}${searchContextSection}`;
                    const finalInput = baseInputWithInstructions.slice();
                    finalInput[0] = { role: 'developer', content: [{ type: 'input_text', text: finalSystemPrompt }] };
                    const requestBody = {
                        ...baseRequestBody,
                        input: finalInput
                    };

                    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.RIGHTCODE_API_KEY}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`OpenAI API Error: ${response.status} ${errorText}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done || clientAborted) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.trim() || line.startsWith(':')) continue;
                            if (!line.startsWith('data: ')) continue;

                            const dataStr = line.slice(6);
                            if (dataStr === '[DONE]') continue;

                            try {
                                const event = JSON.parse(dataStr);

                                // 处理 Responses API 事件
                                if (event.type === 'response.output_text.delta') {
                                    const text = event.delta;
                                    fullText += text;
                                    sendEvent({ type: 'text', content: text });
                                } else if (event.type === 'response.reasoning.delta') {
                                    const thought = event.delta;
                                    fullThought += thought;
                                    sendEvent({ type: 'thought', content: thought });
                                } else if (event.type === 'response.output_text.annotation.added') {
                                    // Web search 引用（url_citation）
                                    const ann = event.annotation;
                                    if (ann?.type === 'url_citation' && ann?.url) {
                                        const exists = citations.some(c => c?.url === ann.url);
                                        if (!exists) {
                                            citations.push({ url: ann.url, title: ann.title });
                                            sendEvent({ type: 'citations', citations });
                                        }
                                    }
                                }
                            } catch { /* ignore parse errors */ }
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
                        const resolvedModelMessageId = modelMessageId;
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
        console.error("OpenAI API Error:", {
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
