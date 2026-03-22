import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import { AGENT_MODEL_ID, normalizeAgentDriverModelId } from "@/lib/shared/models";
import { generateMessageId, isNonEmptyString } from "@/app/api/chat/utils";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
  loadConversationForRoute,
  rollbackConversationTurn,
} from "@/app/api/chat/conversationState";
import { runAgentRuntimeV2 } from "@/lib/server/agent/runtimeV2";
import { parseSeedThinkingLevel, parseWebSearchConfig } from "@/lib/server/chat/requestConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

function buildUserMessageParts({ prompt, images, attachments }) {
  const parts = [];
  if (isNonEmptyString(prompt)) parts.push({ text: prompt });
  for (const item of Array.isArray(images) ? images : []) {
    if (!item?.url || !item?.mimeType) continue;
    parts.push({
      inlineData: {
        url: item.url,
        mimeType: item.mimeType,
      },
    });
  }
  for (const item of Array.isArray(attachments) ? attachments : []) {
    if (!item?.url || !item?.name) continue;
    parts.push({
      fileData: {
        url: item.url,
        name: item.name,
        mimeType: item.mimeType,
        size: Number(item.size) || 0,
        extension: item.extension,
        category: item.category,
        formatSummary: typeof item.formatSummary === "string" ? item.formatSummary : "",
        visualAssetCount: Number(item.visualAssetCount) || 0,
      },
    });
  }
  return parts;
}

function buildConversationTitle(prompt, attachments) {
  const promptText = isNonEmptyString(prompt) ? prompt.trim() : "";
  if (promptText) return promptText.length > 30 ? `${promptText.slice(0, 30)}...` : promptText;
  const firstAttachment = Array.isArray(attachments) ? attachments[0] : null;
  if (firstAttachment?.name) return `附件：${firstAttachment.name}`;
  return "New Chat";
}

function buildTimelineStep(step) {
  if (!step || typeof step !== "object") return null;
  return {
    id: typeof step.id === "string" ? step.id : "",
    kind: typeof step.kind === "string" ? step.kind : "thought",
    status: typeof step.status === "string" ? step.status : "done",
    title: typeof step.title === "string" ? step.title : "",
    content: typeof step.content === "string" ? step.content : "",
    message: typeof step.message === "string" ? step.message : "",
    query: typeof step.query === "string" ? step.query : "",
  };
}

function upsertTimelineStep(list, step) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (!step?.id) {
    next.push(step);
    return next;
  }
  const index = next.findIndex((item) => item?.id === step.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...step };
    return next;
  }
  next.push(step);
  return next;
}

export async function POST(req) {
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

    const {
      prompt,
      model,
      config,
      history,
      historyLimit,
      conversationId,
      mode,
      settings,
      userMessageId,
      modelMessageId,
    } = body || {};

    if (model !== AGENT_MODEL_ID) {
      return Response.json({ error: "当前接口仅支持 Agent 模型" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }
    if (mode === "regenerate" || mode === "continue" || mode === "approve") {
      return Response.json({ error: "Agent 模式已改为当前页同步执行，不再支持继续执行或后台恢复" }, { status: 400 });
    }

    const driverModel = normalizeAgentDriverModelId(config?.agentModel ?? settings?.agentModel);

    try {
      parseSeedThinkingLevel(config?.thinkingLevel);
    } catch (error) {
      return Response.json({ error: error?.message || "thinkingLevel invalid" }, { status: 400 });
    }

    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const rateLimitKey = `agent:${auth.userId}:${clientIP}`;
    const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
    if (!success) {
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return Response.json(
        { error: "请求过于频繁，请稍后再试" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    await dbConnect();
    const userDoc = await User.findById(auth.userId);
    if (!userDoc) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "ARK_API_KEY 未配置" }, { status: 500 });
    }

    const limit = Number.parseInt(historyLimit, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      return Response.json({ error: "historyLimit invalid" }, { status: 400 });
    }

    const currentAttachments = Array.isArray(config?.attachments) ? config.attachments : [];
    const currentImages = Array.isArray(config?.images)
      ? config.images
        .filter((item) => item?.url)
        .map((item) => ({
          url: item.url,
          mimeType: typeof item?.mimeType === "string" && item.mimeType ? item.mimeType : "image/jpeg",
        }))
      : [];

    const userMessageParts = buildUserMessageParts({
      prompt: typeof prompt === "string" ? prompt : "",
      images: currentImages,
      attachments: currentAttachments,
    });

    if (userMessageParts.length === 0) {
      return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
    }

    let currentConversation = await loadConversationForRoute({
      conversationId,
      userId: auth.userId,
      expectedProvider: "vectaix",
    });
    let currentConversationId = conversationId;
    let createdConversationForRequest = false;
    let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
    if (!currentConversationId) {
      const initialSettings = settings && typeof settings === "object"
        ? { ...settings }
        : {};
      delete initialSettings.activePromptId;

      const newConv = await Conversation.create({
        userId: auth.userId,
        title: buildConversationTitle(prompt, currentAttachments),
        model: AGENT_MODEL_ID,
        settings: {
          ...initialSettings,
          agentModel: driverModel,
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

    const resolvedUserMessageId = typeof userMessageId === "string" && userMessageId ? userMessageId : generateMessageId();
    const resolvedModelMessageId = typeof modelMessageId === "string" && modelMessageId ? modelMessageId : generateMessageId();

    const userMessage = {
      id: resolvedUserMessageId,
      role: "user",
      content: typeof prompt === "string" ? prompt : "",
      type: "parts",
      parts: userMessageParts,
    };

    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: currentConversationId, userId: auth.userId },
      {
        $push: { messages: userMessage },
        updatedAt: Date.now(),
      },
      { new: true }
    ).select("updatedAt");
    if (!updatedConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    let writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? Date.now();

    const effectiveHistoryMessages = (limit > 0 ? history.slice(-limit) : history)
      .filter((message) => message?.role === "user" || message?.role === "model");

    const encoder = new TextEncoder();
    let timeline = [];
    let citations = [];
    let fullText = "";
    let fullThought = "";

    const responseStream = new ReadableStream({
      async start(controller) {
        let finalMessagePersisted = false;
        const rollbackCurrentTurn = async () => {
          if (finalMessagePersisted) return;
          await rollbackConversationTurn({
            conversationId: currentConversationId,
            userId: auth.userId,
            createdConversationForRequest,
            isRegenerateMode: false,
            previousMessages,
            previousUpdatedAt,
            userMessageId: resolvedUserMessageId,
            writePermitTime,
          });
        };

        const sendEvent = (payload) => {
          if (payload?.type === "text" && typeof payload.content === "string") {
            fullText += payload.content;
          } else if (payload?.type === "thought" && typeof payload.content === "string") {
            fullThought += payload.content;
          } else if (payload?.type === "citations" && Array.isArray(payload.citations)) {
            citations = payload.citations;
          } else if (payload?.type === "agent_step") {
            const step = buildTimelineStep(payload.step);
            if (step) {
              timeline = upsertTimelineStep(timeline, step);
            }
          } else if (payload?.type === "search_start") {
            timeline = upsertTimelineStep(timeline, {
              id: `search_${payload.round || Date.now()}`,
              kind: "search",
              status: "running",
              query: payload.query || "",
              title: "联网搜索中",
            });
          } else if (payload?.type === "search_result") {
            timeline = upsertTimelineStep(timeline, {
              id: `search_${payload.round || Date.now()}`,
              kind: "search",
              status: "done",
              query: payload.query || "",
              title: "联网搜索完成",
              message: Array.isArray(payload.results) ? `共 ${payload.results.length} 条结果` : "",
            });
          } else if (payload?.type === "search_error") {
            timeline = upsertTimelineStep(timeline, {
              id: `search_error_${payload.round || Date.now()}`,
              kind: "search",
              status: "error",
              query: payload.query || "",
              title: "联网搜索失败",
              message: payload.message || "联网搜索失败",
            });
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        try {
          const result = await runAgentRuntimeV2({
            apiKey,
            req,
            userId: auth.userId,
            conversationId: currentConversationId,
            driverModel,
            prompt: typeof prompt === "string" ? prompt : "",
            historyMessages: effectiveHistoryMessages,
            config,
            attachments: currentAttachments,
            images: currentImages,
            sendEvent,
          });

          const content = result?.finalAnswer || fullText || "任务已完成。";
          const message = {
            id: resolvedModelMessageId,
            role: "model",
            content,
            type: "text",
            parts: [{ text: content }],
            thought: fullThought || "",
            citations: citations.length > 0 ? citations : null,
            thinkingTimeline: timeline,
          };

          const persistedConversation = await Conversation.findOneAndUpdate(
            buildConversationWriteCondition(currentConversationId, auth.userId, writePermitTime),
            {
              $push: { messages: message },
              updatedAt: Date.now(),
            },
            { new: true }
          ).select("updatedAt");
          if (!persistedConversation) {
            const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
            conflictError.status = 409;
            throw conflictError;
          }
          finalMessagePersisted = true;
          writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          try {
            await rollbackCurrentTurn();
          } catch { }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "stream_error",
            message: error?.message || "Unknown error",
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": currentConversationId,
      },
    });
  } catch (error) {
    console.error("Agent API Error:", {
      message: error?.message,
      status: error?.status,
      name: error?.name,
      code: error?.code,
    });
    return Response.json({ error: error?.message || "请求失败" }, { status: error?.status || 500 });
  }
}
