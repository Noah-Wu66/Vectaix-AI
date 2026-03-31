import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import {
  CHAT_RUNTIME_MODE_AGENT,
  getModelAttachmentSupport,
  isAgentBackedModelId,
  isCouncilModel,
  normalizeChatRuntimeMode,
} from "@/lib/shared/models";
import { buildContextSafeHistoryMessages, generateMessageId, isNonEmptyString } from "@/app/api/chat/utils";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
  loadConversationForRoute,
  rollbackConversationTurn,
} from "@/app/api/chat/conversationState";
import { runAgentRuntime } from "@/lib/server/agent/runtime";
import { serializeRuntimeState } from "@/lib/server/agent/core/stateSerializer";
import { parseWebSearchConfig } from "@/lib/server/chat/requestConfig";
import { enrichConversationPartsWithBlobIds } from "@/lib/server/conversations/blobReferences";
import { getAttachmentInputType } from "@/lib/shared/attachments";

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

    const requestedModel = typeof model === "string" ? model.trim() : "";
    if (!isAgentBackedModelId(requestedModel) || isCouncilModel(requestedModel)) {
      return Response.json({ error: "当前接口仅支持非 Council 模型" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }
    if (mode === "regenerate" || mode === "continue" || mode === "approve") {
      return Response.json({ error: "Agent 模式已改为当前页同步执行，不再支持继续执行或后台恢复" }, { status: 400 });
    }

    const driverModel = requestedModel;

    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const rateLimitKey = `agent:${auth.userId}:${clientIP}`;
    const { success, resetTime } = await rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
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
    const {
      supportsImages,
      supportsDocuments,
      supportsVideo,
      supportsAudio,
    } = getModelAttachmentSupport(driverModel, CHAT_RUNTIME_MODE_AGENT);

    if (currentImages.length > 0 && !supportsImages) {
      return Response.json({ error: "当前 Agent 模型不支持图片输入" }, { status: 400 });
    }

    for (const attachment of currentAttachments) {
      const inputType = getAttachmentInputType(attachment?.category);
      const isSupported = (
        (inputType === "file" && supportsDocuments)
        || (inputType === "video" && supportsVideo)
        || (inputType === "audio" && supportsAudio)
      );
      if (!isSupported) {
        return Response.json({ error: "当前 Agent 模型不支持这类附件" }, { status: 400 });
      }
    }

    const userMessageParts = buildUserMessageParts({
      prompt: typeof prompt === "string" ? prompt : "",
      images: currentImages,
      attachments: currentAttachments,
    });
    const parsedWebSearch = parseWebSearchConfig(config?.webSearch);

    if (userMessageParts.length === 0) {
      return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
    }

    let currentConversation = await loadConversationForRoute({
      conversationId,
      userId: auth.userId,
    });
    let currentConversationId = conversationId;
    let createdConversationForRequest = false;
    let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
    if (currentConversation) {
      const currentConversationModel = currentConversation?.model;
      if (isCouncilModel(currentConversationModel)) {
        return Response.json({ error: "当前对话与所选模型不匹配" }, { status: 400 });
      }
    }
    if (!currentConversationId) {
      const newConv = await Conversation.create({
        userId: auth.userId,
        title: buildConversationTitle(prompt, currentAttachments),
        model: requestedModel,
        settings: {
          mode: normalizeChatRuntimeMode(settings?.mode),
          webSearch: parsedWebSearch,
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

    const enrichedUserMessageParts = await enrichConversationPartsWithBlobIds(userMessageParts, {
      userId: auth.userId,
    });

    const userMessage = {
      id: resolvedUserMessageId,
      role: "user",
      content: typeof prompt === "string" ? prompt : "",
      type: "parts",
      parts: enrichedUserMessageParts,
    };

    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: currentConversationId, userId: auth.userId },
      {
        $push: { messages: userMessage },
        $set: {
          model: requestedModel,
          "settings.mode": normalizeChatRuntimeMode(settings?.mode),
          "settings.webSearch": parsedWebSearch,
          updatedAt: Date.now(),
        },
      },
      { new: true }
    ).select("updatedAt");
    if (!updatedConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    let writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? Date.now();

    const effectiveHistoryMessages = buildContextSafeHistoryMessages(
      limit > 0 ? history.slice(-limit) : history
    );

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        let finalMessagePersisted = false;
        let runtimeCompleted = false;
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        try {
          const result = await runAgentRuntime({
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
          runtimeCompleted = true;

          const serializedState = serializeRuntimeState(result?.state || {});
          const message = {
            id: resolvedModelMessageId,
            role: "model",
            content: serializedState.content,
            type: "text",
            parts: [{ text: serializedState.content }],
            thought: serializedState.thought || "",
            citations: serializedState.citations.length > 0 ? serializedState.citations : null,
            thinkingTimeline: serializedState.thinkingTimeline,
            tools: serializedState.tools.length > 0 ? serializedState.tools : null,
            artifacts: serializedState.artifacts.length > 0 ? serializedState.artifacts : null,
            ...(Number.isFinite(serializedState.searchContextTokens) ? { searchContextTokens: serializedState.searchContextTokens } : {}),
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
          if (runtimeCompleted) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "error",
              timestamp: new Date().toISOString(),
              stepIndex: 0,
              data: {
                message: error?.message || "Unknown error",
                phase: "persist",
              },
            })}\n\n`));
          }
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
