import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import {
  getModelConfig,
  isZenMuxChatModel,
} from "@/lib/shared/models";
import {
  isNonEmptyString,
  sanitizeStoredMessagesStrict,
  generateMessageId,
  estimateTokens,
} from "@/app/api/chat/utils";
import { getAttachmentInputType } from "@/lib/shared/attachments";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
  loadConversationForRoute,
  rollbackConversationTurn,
} from "@/app/api/chat/conversationState";
import {
  enrichConversationPartsWithBlobIds,
  enrichStoredMessagesWithBlobIds,
} from "@/lib/server/conversations/blobReferences";
import { prepareDocumentAttachmentMapByUrls } from "@/lib/server/files/service";
import {
  buildDirectChatSystemPrompt,
  buildForcedFinalAnswerInstructions,
} from "@/lib/server/chat/systemPromptBuilder";
import {
  parseSystemPrompt,
  parseWebSearchConfig,
  parseWebSearchEnabled,
} from "@/lib/server/chat/requestConfig";
import {
  buildChatCompletionsRequest,
  createChatOpenAIClient,
  getChatCompletionChunkDelta,
  getChatCompletionChunkThoughtDelta,
  getChatCompletionCompletedUsage,
  getChatCompletionMessage,
  getChatCompletionToolCalls,
  normalizeOpenAIError,
} from "@/lib/server/zenmux/openai";
import {
  createWebBrowsingRuntime,
  executeWebBrowsingNativeToolCall,
  getChatCompletionWebTools,
  WEB_BROWSING_MAX_ROUNDS,
  WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND,
} from "@/lib/server/webBrowsing/nativeTools";
import {
  createWebBrowsingRoundController,
  getMaxWebBrowsingModelPasses,
} from "@/lib/server/webBrowsing/roundControl";
import {
  buildChatMessagesFromHistory,
  buildCurrentUserMessage,
  normalizeOpenAIMessageContentParts,
} from "@/app/api/chat/zenmuxHelpers";
import {
  CHAT_RATE_LIMIT,
  MAX_REQUEST_BYTES,
  SSE_PADDING,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/server/chat/routeConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildZenMuxChatProviderState({ completionId, usage }) {
  const state = {};
  if (typeof completionId === "string" && completionId.trim()) state.completionId = completionId.trim();
  if (usage && typeof usage === "object" && !Array.isArray(usage)) state.usage = usage;
  return Object.keys(state).length > 0 ? { zenmuxChatCompletions: state } : undefined;
}

function normalizeMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }
  return "";
}

function getChatCompletionMessageThought(message) {
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  const reasoningContent = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  if (reasoning && reasoningContent && reasoning !== reasoningContent) {
    return `${reasoning}${reasoningContent}`;
  }
  return reasoningContent || reasoning;
}

function pushUniqueCitations(target, items) {
  if (!Array.isArray(target) || !Array.isArray(items)) return false;
  let changed = false;
  for (const item of items) {
    if (!item?.url) continue;
    if (!target.some((citation) => citation.url === item.url)) {
      target.push({
        url: item.url,
        title: item.title || item.url,
      });
      changed = true;
    }
  }
  return changed;
}

export async function POST(req) {
  let writePermitTime = null;

  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

    if (!model || typeof model !== "string") {
      return Response.json({ error: "Model is required" }, { status: 400 });
    }
    if (typeof prompt !== "string") {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }
    if (!isZenMuxChatModel(model)) {
      return Response.json({ error: "unsupported model" }, { status: 400 });
    }

    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const rateLimitKey = `chat:${auth.userId}:${clientIP}`;
    const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
    if (!success) {
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return Response.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(retryAfter), "X-RateLimit-Remaining": "0" } }
      );
    }

    let user = null;
    try {
      await dbConnect();
      const userDoc = await User.findById(auth.userId);
      if (!userDoc) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      user = auth;
    } catch (dbError) {
      console.error("[ZenMux] connect database:", dbError);
      return Response.json({ error: "Database connection failed" }, { status: 500 });
    }

    let currentConversationId = conversationId;
    let currentConversation = await loadConversationForRoute({
      conversationId: currentConversationId,
      userId: user.userId,
      expectedProvider: getModelConfig(model)?.provider,
    });
    let createdConversationForRequest = false;
    let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();

    const zenMuxClient = createChatOpenAIClient(model);
    const apiModel = model;

    const currentAttachments = Array.isArray(config?.attachments)
      ? config.attachments.filter((item) => getAttachmentInputType(item?.category) === "file" && isNonEmptyString(item?.url))
      : [];

    const limit = Number.parseInt(historyLimit, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      return Response.json({ error: "historyLimit invalid" }, { status: 400 });
    }

    const isRegenerateMode = mode === "regenerate" && user && currentConversationId && Array.isArray(messages);
    const resolvedUserMessageId = (typeof userMessageId === "string" && userMessageId.trim()) ? userMessageId.trim() : generateMessageId();
    const resolvedModelMessageId = (typeof modelMessageId === "string" && modelMessageId.trim()) ? modelMessageId.trim() : generateMessageId();

    let chatMessages = [];
    let storedMessagesForRegenerate = null;

    const collectAttachmentUrls = (msgs) => msgs.flatMap((msg) =>
      Array.isArray(msg?.parts)
        ? msg.parts
          .map((part) => part?.fileData)
          .filter((file) => getAttachmentInputType(file?.category) === "file" && isNonEmptyString(file?.url))
          .map((file) => file.url)
        : []
    );

    if (isRegenerateMode) {
      let sanitized;
      try {
        sanitized = sanitizeStoredMessagesStrict(messages);
      } catch (e) {
        return Response.json({ error: e?.message || "messages invalid" }, { status: 400 });
      }
      sanitized = await enrichStoredMessagesWithBlobIds(sanitized, { userId: user.userId });
      const regenerateTime = new Date();
      const conv = await Conversation.findOneAndUpdate(
        { _id: currentConversationId, userId: user.userId },
        { $set: { messages: sanitized, updatedAt: regenerateTime } },
        { new: true }
      ).select("messages updatedAt");
      if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
      storedMessagesForRegenerate = sanitized;
      writePermitTime = conv.updatedAt?.getTime?.();

      const msgs = storedMessagesForRegenerate;
      const historyBeforeCurrentPrompt = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === "user" ? msgs.slice(0, -1) : msgs;
      const currentTurn = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === "user" ? [msgs[msgs.length - 1]] : [];
      const effectiveHistory = (limit > 0) ? historyBeforeCurrentPrompt.slice(-limit) : historyBeforeCurrentPrompt;
      const inputMessages = [...effectiveHistory, ...currentTurn];
      const fileTextMap = await prepareDocumentAttachmentMapByUrls(collectAttachmentUrls(inputMessages), {
        userId: user.userId, conversationId: currentConversationId, signal: req?.signal,
      });
      chatMessages = await buildChatMessagesFromHistory(inputMessages, { fileTextMap });
    } else {
      const effectiveHistory = (limit > 0) ? history.slice(-limit) : history;
      const fileTextMap = await prepareDocumentAttachmentMapByUrls(collectAttachmentUrls(effectiveHistory), {
        userId: user.userId, conversationId: currentConversationId, signal: req?.signal,
      });
      chatMessages = await buildChatMessagesFromHistory(effectiveHistory, { fileTextMap });
    }

    const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
    const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
    let webSearchConfig;
    let enableWebSearch;
    try {
      webSearchConfig = parseWebSearchConfig(config?.webSearch);
      enableWebSearch = parseWebSearchEnabled(config?.webSearch) && getModelConfig(model)?.supportsWebSearch === true;
    } catch (error) {
      return Response.json({ error: error?.message || "webSearch invalid" }, { status: 400 });
    }

    if (user && !currentConversationId) {
      const titleSource = isNonEmptyString(prompt) ? prompt : (currentAttachments[0]?.name || (config?.images?.length ? "图片对话" : "New Chat"));
      const title = titleSource.length > 30 ? `${titleSource.substring(0, 30)}...` : titleSource;
      const newConv = await Conversation.create({
        userId: user.userId,
        title,
        model,
        settings: {
          ...(settings && typeof settings === "object" ? settings : {}),
          webSearch: webSearchConfig,
        },
        messages: [],
      });
      currentConversationId = newConv._id.toString();
      currentConversation = newConv.toObject();
      createdConversationForRequest = true;
      previousMessages = [];
      previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
    }

    let dbImageEntries = [];
    let attachmentEntries = [];
    if (!isRegenerateMode) {
      let fileTextMap = new Map();
      if (currentAttachments.length > 0) {
        fileTextMap = await prepareDocumentAttachmentMapByUrls(
          currentAttachments.map((item) => item.url),
          { userId: user.userId, conversationId: currentConversationId, signal: req?.signal }
        );
        attachmentEntries = currentAttachments.filter((item) => fileTextMap.has(item.url));
      }
      if (Array.isArray(config?.images)) {
        dbImageEntries = config.images.filter((img) => img?.url).map((img) => ({ url: img.url, mimeType: img.mimeType || "image/jpeg" }));
      }

      const currentContent = await buildCurrentUserMessage({
        prompt,
        images: config?.images,
        attachments: attachmentEntries,
        fileTextMap,
      });
      if (currentContent.length === 0) {
        return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
      }
      chatMessages.push({
        role: "user",
        content: normalizeOpenAIMessageContentParts(currentContent),
      });

      if (user) {
        const storedUserParts = [];
        if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });
        for (const entry of dbImageEntries) {
          storedUserParts.push({ inlineData: { mimeType: entry.mimeType, url: entry.url } });
        }
        for (const attachment of attachmentEntries) {
          storedUserParts.push({
            fileData: {
              url: attachment.url, name: attachment.name, mimeType: attachment.mimeType,
              size: attachment.size, extension: attachment.extension, category: attachment.category,
            },
          });
        }
        const enrichedStoredUserParts = await enrichConversationPartsWithBlobIds(storedUserParts, { userId: user.userId });
        const userMsgTime = new Date();
        const userMessage = {
          id: resolvedUserMessageId, role: "user", content: prompt, type: "parts", parts: enrichedStoredUserParts,
        };
        const updatedConv = await Conversation.findOneAndUpdate(
          { _id: currentConversationId, userId: user.userId },
          { $push: { messages: userMessage }, updatedAt: userMsgTime },
          { new: true }
        ).select("updatedAt");
        if (!updatedConv) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        writePermitTime = updatedConv.updatedAt?.getTime?.() ?? userMsgTime.getTime();
      }
    }

    const encoder = new TextEncoder();
    let clientAborted = false;
    const onAbort = () => { clientAborted = true; };
    try { req?.signal?.addEventListener?.("abort", onAbort, { once: true }); } catch { /* ignore */ }

    let paddingSent = false;
    let heartbeatTimer = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        let fullText = "";
        let fullThought = "";
        let finalUsage = null;
        let finalCompletionId = "";
        let finalMessagePersisted = false;
        const citations = [];
        const toolRecords = [];
        let searchContextTokens = 0;

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
            try { if (!clientAborted) controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`)); } catch { /* ignore */ }
          };
          heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
          sendHeartbeat();

          const sendEvent = (payload) => {
            const padding = !paddingSent ? SSE_PADDING : "";
            paddingSent = true;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
          };

          const pushCitations = (items) => {
            if (pushUniqueCitations(citations, items)) {
              sendEvent({ type: "citations", citations });
            }
          };

          const systemPrompt = await buildDirectChatSystemPrompt({
            userSystemPrompt, systemPromptSuffix, enableWebSearch, searchContextSection: "",
          });

          if (enableWebSearch) {
            const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
            const roundController = createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS });
            const loopMessages = [...chatMessages];
            const maxPasses = getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS);
            let finished = false;

            for (let pass = 0; pass < maxPasses; pass += 1) {
              if (clientAborted) break;

              const availableToolApiNames = roundController.getAvailableToolApiNames();
              const tools = availableToolApiNames.length > 0
                ? getChatCompletionWebTools(availableToolApiNames)
                : undefined;
              const activeSystemPrompt = availableToolApiNames.length > 0
                ? systemPrompt
                : buildForcedFinalAnswerInstructions(systemPrompt);
              const response = await zenMuxClient.chat.completions.create(
                buildChatCompletionsRequest({
                  model: apiModel,
                  messages: loopMessages,
                  system: activeSystemPrompt,
                  stream: false,
                  tools,
                }),
                { signal: req?.signal }
              );

              if (typeof response?.id === "string" && response.id.trim()) {
                finalCompletionId = response.id.trim();
              }
              const usage = getChatCompletionCompletedUsage(response);
              if (usage) {
                finalUsage = usage;
              }

              const message = getChatCompletionMessage(response) || {};
              const thought = getChatCompletionMessageThought(message);
              if (thought) {
                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                sendEvent({ type: "thought", content: thought });
              }

              const toolCalls = Array.isArray(tools)
                ? getChatCompletionToolCalls(response)
                  .filter((item) => typeof item?.id === "string" && item.id && typeof item?.function?.name === "string" && item.function.name)
                  .slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)
                : [];

              if (toolCalls.length === 0) {
                fullText = normalizeMessageText(message?.content).trim();
                if (fullText) {
                  sendEvent({ type: "text", content: fullText });
                }
                finished = true;
                break;
              }

              loopMessages.push({
                role: "assistant",
                content: normalizeMessageText(message?.content),
                tool_calls: toolCalls,
              });

              for (const toolCall of toolCalls) {
                const apiName = toolCall?.function?.name;
                const reservation = roundController.reserve(apiName);
                if (!reservation.allowed) {
                  const messageText = `联网工具调用超出限制：${apiName || "unknown"}`;
                  sendEvent({ type: "search_error", round: reservation.round || undefined, query: "", message: messageText });
                  throw new Error(messageText);
                }

                const toolExecution = await executeWebBrowsingNativeToolCall({
                  apiName,
                  argumentsInput: toolCall?.function?.arguments,
                  runtime,
                  sendEvent,
                  pushCitations,
                  round: reservation.round,
                  signal: req?.signal,
                });
                toolRecords.push(toolExecution.toolRecord);
                searchContextTokens += estimateTokens(toolExecution.outputText);
                loopMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: toolExecution.outputText,
                });
                if (toolExecution.result?.success === false) {
                  throw new Error(toolExecution.outputText || "联网搜索失败");
                }
              }
            }

            if (!finished && !clientAborted) {
              throw new Error("联网搜索轮次已用完，模型未返回最终回答");
            }

            if (searchContextTokens > 0) {
              sendEvent({ type: "search_context_tokens", tokens: searchContextTokens });
            }
          } else {
            const stream = await zenMuxClient.chat.completions.create(
              buildChatCompletionsRequest({
                model: apiModel,
                messages: chatMessages,
                system: systemPrompt,
                stream: true,
              }),
              { signal: req?.signal }
            );

            for await (const chunk of stream) {
              if (clientAborted) break;

              if (typeof chunk?.id === "string" && chunk.id.trim()) {
                finalCompletionId = chunk.id.trim();
              }

              const delta = getChatCompletionChunkDelta(chunk);
              const textDelta = typeof delta?.content === "string" ? delta.content : "";
              if (textDelta) {
                fullText += textDelta;
                sendEvent({ type: "text", content: textDelta });
              }

              const thoughtDelta = getChatCompletionChunkThoughtDelta(chunk);
              if (thoughtDelta) {
                fullThought += thoughtDelta;
                sendEvent({ type: "thought", content: thoughtDelta });
              }

              const usage = getChatCompletionCompletedUsage(chunk);
              if (usage) {
                finalUsage = usage;
              }
            }
          }

          if (clientAborted) {
            await rollbackCurrentTurn();
            try { controller.close(); } catch { /* ignore */ }
            return;
          }

          fullText = fullText.trim();
          fullThought = fullThought.trim();

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));

          if (user && currentConversationId) {
            const providerState = buildZenMuxChatProviderState({
              completionId: finalCompletionId,
              usage: finalUsage,
            });
            const modelMessage = {
              id: resolvedModelMessageId,
              role: "model",
              content: fullText,
              thought: fullThought,
              type: "text",
              parts: [{ text: fullText }],
              ...(toolRecords.length > 0 ? { tools: toolRecords } : {}),
              ...(citations.length > 0 ? { citations } : {}),
              ...(searchContextTokens > 0 ? { searchContextTokens } : {}),
              ...(providerState ? { providerState } : {}),
            };
            const persistedConversation = await Conversation.findOneAndUpdate(
              buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
              { $push: { messages: modelMessage }, updatedAt: new Date() },
              { new: true }
            ).select("updatedAt");
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
          const error = normalizeOpenAIError(err);
          if (clientAborted) {
            try { await rollbackCurrentTurn(); } catch { /* ignore */ }
            try { controller.close(); } catch { /* ignore */ }
            return;
          }
          try { await rollbackCurrentTurn(); } catch { /* ignore */ }
          try {
            const errorPayload = JSON.stringify({ type: "stream_error", message: error?.message || "Unknown error" });
            const padding = !paddingSent ? SSE_PADDING : "";
            paddingSent = true;
            controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            controller.error(error);
          }
        } finally {
          if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          try { req?.signal?.removeEventListener?.("abort", onAbort); } catch { /* ignore */ }
        }
      },
    });

    const headers = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    if (currentConversationId) {
      headers["X-Conversation-Id"] = currentConversationId;
    }
    return new Response(responseStream, { headers });
  } catch (error) {
    console.error("[ZenMux] handle chat request:", error);
    const rawStatus = typeof error?.status === "number" ? error.status : 500;
    const isUpstreamAuthError = rawStatus === 401;
    const status = isUpstreamAuthError ? 500 : rawStatus;
    let errorMessage = error?.message;
    if (isUpstreamAuthError) {
      errorMessage = "模型服务认证失败，请检查接口配置";
    } else if (error?.message?.includes("API_KEY") || error?.message?.includes("ZENMUX")) {
      errorMessage = "API configuration error. Please check your API keys.";
    }
    return Response.json({ error: errorMessage }, { status });
  }
}
