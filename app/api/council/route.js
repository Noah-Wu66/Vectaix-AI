import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import User from '@/models/User';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptMessage, encryptString } from '@/lib/encryption';
import {
    isNonEmptyString,
    generateMessageId,
    injectCurrentTimeSystemReminder,
    buildWebSearchContextBlock,
    estimateTokens
} from '@/app/api/chat/utils';
import { buildWebSearchGuide, runWebSearchOrchestration } from '@/app/api/chat/webSearchOrchestrator';
import { BASE_SYSTEM_PROMPT_TEXT } from '@/app/api/chat/systemPrompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHAT_RATE_LIMIT = { limit: 15, windowMs: 60 * 1000 };

const SYNTHESIS_SYSTEM_PROMPT = `You are a senior research synthesis analyst. You will receive the outputs of three AI models (GPT, Opus, Pro) responding to the same user question.

Your task is to produce a structured multi-perspective analysis in Chinese, following this exact format:

# [用户问题的简短概括]——多视角深度分析

## 模型相同观点

| 发现 | GPT | Opus | Pro | 证据 |
|------|-----|------|-----|------|
| [共识观点] | ✓ | ✓ | ✓ | [支撑证据] |

## 模型分歧观点

| 主题 | GPT | Opus | Pro | 分歧原因 |
|------|-----|------|-----|----------|
| [分歧主题] | [GPT立场] | [Opus立场] | [Pro立场] | [分歧原因分析] |

## 独特发现

| 模型 | 独特发现 | 重要性 |
|------|----------|--------|
| [模型名] | [独特发现] | [重要性说明] |

## 综合分析

[对所有模型观点的深度综合分析，包含多个小节，每节有标题。分析应当深入、全面、有洞察力。]

Rules:
- Write entirely in Chinese
- Model names: use "GPT", "Opus", "Pro" only
- Do NOT include any URLs or links
- Be thorough and analytical in the 综合分析 section
- If models largely agree, focus more on nuances and unique findings
- The tables should capture ALL significant points, not just a few
- 证据 column should describe the evidence without URLs`;

async function runGeminiModel(prompt, systemPrompt, clientAborted) {
    const ai = new GoogleGenAI({
        apiKey: process.env.ZENMUX_API_KEY,
        httpOptions: { apiVersion: 'v1', baseUrl: 'https://zenmux.ai/api/vertex-ai' }
    });
    let text = "";
    let thought = "";
    const stream = await ai.models.generateContentStream({
        model: "google/gemini-3-pro-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            maxOutputTokens: 65536,
            thinkingConfig: { thinkingLevel: "high", includeThoughts: true }
        }
    });
    for await (const chunk of stream) {
        if (clientAborted()) break;
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
            if (clientAborted()) break;
            if (part.thought && part.text) thought += part.text;
            else if (part.text) text += part.text;
        }
    }
    return { text, thought };
}

async function runClaudeOpusModel(prompt, systemPrompt, clientAborted) {
    const client = new Anthropic({
        apiKey: process.env.RIGHTCODE_API_KEY,
        baseURL: "https://www.right.codes/claude-aws",
        defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" }
    });
    let text = "";
    let thought = "";
    const stream = await client.messages.stream({
        model: "claude-opus-4-6-20260205",
        max_tokens: 64000,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        stream: true,
        thinking: { type: "adaptive" },
        output_config: { effort: "max" }
    });
    for await (const event of stream) {
        if (clientAborted()) break;
        if (event.type === 'content_block_delta') {
            if (event.delta.type === 'thinking_delta') thought += event.delta.thinking;
            else if (event.delta.type === 'text_delta') text += event.delta.text;
        }
    }
    return { text, thought };
}

async function runGPTModel(prompt, systemPrompt, clientAborted) {
    const body = {
        model: "gpt-5.2",
        stream: true,
        max_output_tokens: 128000,
        reasoning: { effort: "xhigh", summary: "auto" },
        input: [
            { role: 'developer', content: [{ type: 'input_text', text: systemPrompt }] },
            { role: 'user', content: [{ type: 'input_text', text: prompt }] }
        ]
    };
    const response = await fetch('https://www.right.codes/codex/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RIGHTCODE_API_KEY}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GPT API Error: ${response.status} ${errorText}`);
    }
    let text = "";
    let thought = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done || clientAborted()) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.trim() || line.startsWith(':') || !line.startsWith('data: ')) continue;
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
                const event = JSON.parse(dataStr);
                if (event.type === 'response.reasoning.delta') thought += event.delta;
                else if (event.type === 'response.output_text.delta') text += event.delta;
            } catch { /* ignore */ }
        }
    }
    return { text, thought };
}

async function runOpusSynthesis(userPrompt, gptOutput, opusOutput, geminiOutput, systemPrompt, sendEvent, clientAborted) {
    const client = new Anthropic({
        apiKey: process.env.RIGHTCODE_API_KEY,
        baseURL: "https://www.right.codes/claude-aws",
        defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" }
    });

    const synthesisPrompt = `用户的原始问题：
${userPrompt}

---

以下是三个模型对该问题的回答：

## GPT 的回答：
${gptOutput}

## Opus 的回答：
${opusOutput}

## Pro 的回答：
${geminiOutput}

---

请按照你的系统指令格式，对以上三个模型的回答进行深度对比分析和综合整理。`;

    let fullText = "";
    let fullThought = "";
    const stream = await client.messages.stream({
        model: "claude-opus-4-6-20260205",
        max_tokens: 128000,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: synthesisPrompt }] }],
        stream: true,
        thinking: { type: "adaptive" },
        output_config: { effort: "max" }
    });

    for await (const event of stream) {
        if (clientAborted()) break;
        if (event.type === 'content_block_delta') {
            if (event.delta.type === 'thinking_delta') {
                fullThought += event.delta.thinking;
                sendEvent({ type: 'thought', content: event.delta.thinking });
            } else if (event.delta.type === 'text_delta') {
                fullText += event.delta.text;
                sendEvent({ type: 'text', content: event.delta.text });
            }
        }
    }
    return { text: fullText, thought: fullThought };
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

        const { prompt, model, config, history, conversationId, settings, userMessageId, modelMessageId } = body;

        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }

        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const clientIP = getClientIP(req);
        const rateLimitKey = `council:${auth.userId}:${clientIP}`;
        const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
        if (!success) {
            const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
            return Response.json(
                { error: '请求过于频繁，请稍后再试' },
                { status: 429, headers: { 'Retry-After': String(retryAfter) } }
            );
        }

        let user = null;
        try {
            await dbConnect();
            const userDoc = await User.findById(auth.userId);
            if (!userDoc) {
                return Response.json({ error: 'Unauthorized' }, { status: 401 });
            }
            if (!userDoc.premium) {
                return Response.json({ error: 'Council 模式仅限高级用户使用' }, { status: 403 });
            }
            user = auth;
        } catch (dbError) {
            console.error("Database connection error:", dbError?.message);
            return Response.json({ error: 'Database connection failed' }, { status: 500 });
        }

        let currentConversationId = conversationId;

        if (user && !currentConversationId) {
            const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
            const newConv = await Conversation.create({
                userId: user.userId,
                title: encryptString(title),
                model: 'council',
                settings: settings,
                messages: []
            });
            currentConversationId = newConv._id.toString();
        }

        // 保存用户消息
        if (user) {
            const userMsgTime = Date.now();
            const encryptedUserMessage = encryptMessage({
                id: userMessageId,
                role: 'user',
                content: prompt,
                type: 'text',
                parts: [{ text: prompt }]
            });
            const updatedConv = await Conversation.findOneAndUpdate(
                { _id: currentConversationId, userId: user.userId },
                { $push: { messages: encryptedUserMessage }, updatedAt: userMsgTime },
                { new: true }
            ).select('updatedAt');
            writePermitTime = updatedConv?.updatedAt?.getTime?.();
        }

        const enableWebSearch = config?.webSearch === true;
        const baseSystemPromptText = BASE_SYSTEM_PROMPT_TEXT;
        const formattingGuard = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

        // Council 上下文：只取最后一条 model 消息作为上下文
        let previousContext = "";
        if (Array.isArray(history) && history.length > 0) {
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i]?.role === 'model' && typeof history[i]?.content === 'string' && history[i].content.trim()) {
                    previousContext = history[i].content;
                    break;
                }
            }
        }
        const effectivePrompt = previousContext
            ? `[以下是上一轮 Council 分析的结果，供你参考]\n\n${previousContext}\n\n---\n\n[用户的新问题]\n${prompt}`
            : prompt;

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try { req?.signal?.addEventListener?.('abort', onAbort, { once: true }); } catch { }

        const PADDING = ' '.repeat(2048);
        let paddingSent = false;
        const HEARTBEAT_INTERVAL_MS = 10000;
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
                        } catch { }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
                    };

                    const isAborted = () => clientAborted;

                    // Phase 1: Web search (optional, using Gemini Flash for decision)
                    let searchContextText = "";
                    let searchContextTokens = 0;
                    if (enableWebSearch) {
                        const webSearchGuide = buildWebSearchGuide(true);
                        const geminiAi = new GoogleGenAI({
                            apiKey: process.env.ZENMUX_API_KEY,
                            httpOptions: { apiVersion: 'v1', baseUrl: 'https://zenmux.ai/api/vertex-ai' }
                        });

                        const runDecisionStream = async (systemText, userText) => {
                            let decisionText = "";
                            const decisionStream = await geminiAi.models.generateContentStream({
                                model: "google/gemini-3-flash-preview",
                                contents: [{ role: "user", parts: [{ text: userText }] }],
                                config: {
                                    systemInstruction: { parts: [{ text: systemText }] },
                                    maxOutputTokens: 512
                                }
                            });
                            for await (const chunk of decisionStream) {
                                if (clientAborted) break;
                                const parts = chunk.candidates?.[0]?.content?.parts;
                                if (!parts) continue;
                                for (const part of parts) {
                                    if (part.text && !part.thought) decisionText += part.text;
                                }
                            }
                            return decisionText;
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

                        const result = await runWebSearchOrchestration({
                            enableWebSearch: true,
                            prompt,
                            runDecisionStream,
                            sendEvent,
                            pushCitations,
                            sendSearchError,
                            isClientAborted: isAborted,
                            providerLabel: 'Council',
                        });
                        searchContextText = result.searchContextText || "";
                        if (searchContextText) {
                            searchContextTokens = estimateTokens(searchContextText);
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

                    // Phase 2: Run 3 models in parallel
                    const searchContextSection = searchContextText ? buildWebSearchContextBlock(searchContextText) : "";
                    const webSearchGuide = buildWebSearchGuide(enableWebSearch);
                    const modelSystemPrompt = injectCurrentTimeSystemReminder(
                        `${baseSystemPromptText}\n\n${formattingGuard}${webSearchGuide}${searchContextSection}`
                    );

                    sendEvent({ type: 'thought', content: '正在同时咨询三位专家模型...\n' });

                    const modelLabels = ['Gemini 3 Pro', 'Claude Opus 4.6 Thinking', 'GPT-5.2 Thinking'];
                    const modelPromises = [
                        runGeminiModel(effectivePrompt, modelSystemPrompt, isAborted)
                            .then(r => { sendEvent({ type: 'thought', content: `\n✓ Pro 已完成\n` }); return r; })
                            .catch(e => { sendEvent({ type: 'thought', content: `\n✗ Pro 出错: ${e?.message}\n` }); return { text: `[Pro 响应失败: ${e?.message}]`, thought: "" }; }),
                        runClaudeOpusModel(effectivePrompt, modelSystemPrompt, isAborted)
                            .then(r => { sendEvent({ type: 'thought', content: `\n✓ Opus 已完成\n` }); return r; })
                            .catch(e => { sendEvent({ type: 'thought', content: `\n✗ Opus 出错: ${e?.message}\n` }); return { text: `[Opus 响应失败: ${e?.message}]`, thought: "" }; }),
                        runGPTModel(effectivePrompt, modelSystemPrompt, isAborted)
                            .then(r => { sendEvent({ type: 'thought', content: `\n✓ GPT 已完成\n` }); return r; })
                            .catch(e => { sendEvent({ type: 'thought', content: `\n✗ GPT 出错: ${e?.message}\n` }); return { text: `[GPT 响应失败: ${e?.message}]`, thought: "" }; }),
                    ];

                    const [geminiResult, opusResult, gptResult] = await Promise.all(modelPromises);

                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

                    sendEvent({ type: 'thought', content: '\n三位专家已全部完成，正在由 Opus 进行综合分析...\n\n' });

                    // Phase 3: Opus synthesis
                    const synthesisResult = await runOpusSynthesis(
                        prompt,
                        gptResult.text,
                        opusResult.text,
                        geminiResult.text,
                        SYNTHESIS_SYSTEM_PROMPT,
                        sendEvent,
                        isAborted
                    );

                    fullText = synthesisResult.text;
                    fullThought = synthesisResult.thought;

                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }

                    if (citations.length > 0) {
                        sendEvent({ type: 'citations', citations });
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    // Save to database
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
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }],
                            councilOutputs: {
                                gemini: { text: geminiResult.text, thought: geminiResult.thought },
                                opus: { text: opusResult.text, thought: opusResult.thought },
                                gpt: { text: gptResult.text, thought: gptResult.thought },
                            }
                        });
                        await Conversation.findOneAndUpdate(
                            writeCondition,
                            { $push: { messages: encryptedModelMessage }, updatedAt: Date.now() }
                        );
                    }
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { controller.close(); } catch { }
                        return;
                    }
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
                    try { req?.signal?.removeEventListener?.('abort', onAbort); } catch { }
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
        console.error("Council API Error:", {
            message: error?.message,
            status: error?.status,
            name: error?.name,
        });
        const status = typeof error?.status === 'number' ? error.status : 500;
        return Response.json({ error: error?.message }, { status });
    }
}
