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
import {
    metasoSearch,
    buildMetasoContext,
    buildMetasoCitations,
    buildMetasoSearchEventResults
} from '@/app/api/chat/metasoSearch';

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
        } catch (jsonError) {
            console.error("Invalid JSON in request body:", jsonError);
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { prompt, model, config, history = [], historyLimit = 0, conversationId, mode, messages, settings, routeLevel } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }

        // 三级路由配置：主线路 → 备用线路 → 保障线路
        // routeLevel: null/undefined=主线路, "fallback"=备用线路, "guarantee"=保障线路
        let apiConfig;
        if (routeLevel === "guarantee") {
            apiConfig = { apiKey: process.env.AIHUBMIX_API_KEY, baseURL: "https://aihubmix.com" };
            console.log("[Claude] 使用保障线路 AIHUBMIX");
        } else if (routeLevel === "fallback") {
            apiConfig = { apiKey: process.env.RIGHTCODE_API_KEY, baseURL: "https://www.right.codes/claude-aws" };
            console.log("[Claude] 使用备用线路 RIGHT.CODES-AWS");
        } else {
            apiConfig = { apiKey: process.env.RIGHTCODE_API_KEY, baseURL: "https://www.right.codes/claude" };
        }

        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
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
            console.error("Database connection error:", dbError);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        let currentConversationId = conversationId;

        const client = new Anthropic({
            apiKey: apiConfig.apiKey,
            baseURL: apiConfig.baseURL,
            defaultHeaders: {
                "anthropic-beta": "extended-cache-ttl-2025-04-11"
            }
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
                            mimeType: entry.mimeType || 'image/jpeg',
                            url: entry.url,
                        },
                    });
                }
            }

            const userMsgTime = Date.now();
            const updatedConv = await Conversation.findByIdAndUpdate(currentConversationId, {
                $push: {
                    messages: {
                        role: 'user',
                        content: prompt,
                        type: 'text',
                        images: dbImageEntries.map(e => e.url),
                        ...(dbImageMimeType ? { mimeType: dbImageMimeType } : {}),
                        parts: storedUserParts
                    }
                },
                updatedAt: userMsgTime
            }, { new: true }).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.() || userMsgTime;
        }

        // 构建请求参数（联网检索上下文将在流式开始前注入）
        const maxTokens = config?.maxTokens || 64000;
        const budgetTokens = config?.budgetTokens || 32000;
        // Claude 使用内置系统提示词（保障线路使用独立的简化提示词）
        const claudeSystemPrompt = routeLevel === "guarantee"
            ? "You are a helpful AI assistant."
            : "Additionally, you are a capable general assistant. Please feel free to answer questions on a wide range of topics. Do not restrict your helpfulness to just coding tasks.";
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        // 是否启用联网搜索
        const enableWebSearch = config?.webSearch === true;

        // 联网搜索时追加引用格式指令
        const webSearchGuide = enableWebSearch
            ? "\n\nWhen citing information from web search results, add the source domain in parentheses at the end of the relevant sentence, e.g. (reuters.com)."
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

                    const pushCitations = (items) => {
                        for (const item of items || []) {
                            if (!item?.url) continue;
                            if (!citations.some(c => c.url === item.url)) {
                                citations.push({ url: item.url, title: item.title || null, cited_text: null });
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
                            thinking: {
                                type: "enabled",
                                budget_tokens: 1024
                            }
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
                        const decisionSystem = "你是联网检索决策器。必须只输出严格 JSON，不要输出任何多余文本。";
                        const decisionUser = `用户问题：${prompt}\n\n判断是否必须联网检索才能回答。\n- 需要联网：输出 {"needSearch": true, "query": "精炼检索词"}\n- 不需要联网：输出 {"needSearch": false}`;
                        const decisionText = await runDecisionStream(decisionSystem, decisionUser);
                        const decision = parseJsonFromText(decisionText) || {};
                        let needSearch = decision?.needSearch === true;
                        let nextQuery = typeof decision?.query === 'string' ? decision.query.trim() : "";

                        const searchContextParts = [];
                        const maxSearchRounds = 5;
                        for (let round = 0; round < maxSearchRounds && needSearch && nextQuery; round++) {
                            if (clientAborted) break;
                            sendEvent({ type: 'search_start', query: nextQuery });
                            let results = [];
                            try {
                                const searchData = await metasoSearch(nextQuery, {
                                    scope: "webpage",
                                    includeSummary: true,
                                    size: 20,
                                    includeRawContent: false,
                                    conciseSnippet: false
                                });
                                results = searchData?.results || [];
                            } catch (searchError) {
                                console.error("[Claude] MetaSo Search Error:", searchError);
                            }

                            const eventResults = buildMetasoSearchEventResults(results, 10);
                            sendEvent({ type: 'search_result', query: nextQuery, results: eventResults });
                            pushCitations(buildMetasoCitations(results));

                            const contextBlock = buildMetasoContext(results, { maxItems: 6 });
                            if (contextBlock) {
                                searchContextParts.push(`检索词: ${nextQuery}\n${contextBlock}`);
                            }

                            if (round === maxSearchRounds - 1) break;

                            const recentContext = searchContextParts.slice(-2).join("\n\n");
                            const enoughSystem = "你是联网检索补充决策器。必须只输出严格 JSON，不要输出任何多余文本。";
                            const enoughUser = `用户问题：${prompt}\n\n已获得的检索摘要：\n${recentContext || "(无)"}\n\n判断这些信息是否足够回答。\n- 足够：输出 {"enough": true}\n- 不足：输出 {"enough": false, "nextQuery": "新的检索词"}`;
                            const enoughText = await runDecisionStream(enoughSystem, enoughUser);
                            const enoughDecision = parseJsonFromText(enoughText) || {};
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
                        ? `\n\nWeb search results:\n${searchContextText}`
                        : "";
                    const systemPrompt = `${claudeSystemPrompt}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`;
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
                        thinking: {
                            type: "enabled",
                            budget_tokens: budgetTokens
                        }
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
                                const citationData = delta.citations || [];
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
                                        citations: citations.length > 0 ? citations : null,
                                        type: 'text',
                                        parts: [{ text: fullText }]
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
