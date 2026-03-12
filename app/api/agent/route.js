import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import { AGENT_MODEL_ID } from "@/lib/shared/models";
import { isNonEmptyString, sanitizeStoredMessagesStrict } from "@/app/api/chat/utils";
import { runAgentRuntime } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

function extractAttachmentsFromMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((part) => part?.fileData?.url && part?.fileData?.name)
    .map((part) => ({
      url: part.fileData.url,
      name: part.fileData.name,
      mimeType: part.fileData.mimeType,
      size: Number(part.fileData.size) || 0,
      extension: part.fileData.extension,
      category: part.fileData.category,
    }));
}

function extractImagesFromMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((part) => part?.inlineData?.url && part?.inlineData?.mimeType)
    .map((part) => ({
      url: part.inlineData.url,
      mimeType: part.inlineData.mimeType,
    }));
}

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
      },
    });
  }
  return parts;
}

function createTimelineStepFromAgentEvent(step) {
  if (!step || typeof step !== "object") return null;
  return {
    id: step.id,
    kind: step.kind || "thought",
    status: step.status || "done",
    title: typeof step.title === "string" ? step.title : "",
    content: typeof step.content === "string" ? step.content : "",
    message: typeof step.message === "string" ? step.message : "",
    query: typeof step.query === "string" ? step.query : "",
  };
}

function pushOrReplaceTimelineStep(timeline, nextStep) {
  if (!nextStep?.id) {
    timeline.push(nextStep);
    return timeline;
  }
  const next = Array.isArray(timeline) ? timeline.slice() : [];
  const index = next.findIndex((item) => item?.id === nextStep.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...nextStep };
    return next;
  }
  next.push(nextStep);
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
      messages,
      settings,
      userMessageId,
      modelMessageId,
      runId,
      resume,
      approvalDecision,
    } = body || {};

    if (model !== AGENT_MODEL_ID) {
      return Response.json({ error: "当前接口仅支持 Agent 模型" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
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

    let currentConversationId = conversationId;
    const isResume = resume === true && isNonEmptyString(runId);
    const isRegenerateMode = mode === "regenerate" && currentConversationId && Array.isArray(messages);
    let storedMessagesForRegenerate = null;

    if (!currentConversationId && !isResume) {
      const titleSource = isNonEmptyString(prompt)
        ? prompt
        : (Array.isArray(config?.attachments) && config.attachments[0]?.name
          ? `附件：${config.attachments[0].name}`
          : "New Chat");
      const title = titleSource.length > 30 ? `${titleSource.substring(0, 30)}...` : titleSource;
      const newConv = await Conversation.create({
        userId: auth.userId,
        title,
        model: AGENT_MODEL_ID,
        settings,
        messages: [],
      });
      currentConversationId = newConv._id.toString();
    }

    if (!currentConversationId) {
      return Response.json({ error: "conversationId missing" }, { status: 400 });
    }

    let effectiveHistoryMessages = [];
    let currentPrompt = typeof prompt === "string" ? prompt : "";
    let currentAttachments = Array.isArray(config?.attachments) ? config.attachments : [];
    let currentImages = Array.isArray(config?.images)
      ? config.images
        .filter((item) => item?.url)
        .map((item) => ({
          url: item.url,
          mimeType: typeof item?.mimeType === "string" && item.mimeType ? item.mimeType : "image/jpeg",
        }))
      : [];

    if (isRegenerateMode) {
      let sanitized;
      try {
        sanitized = sanitizeStoredMessagesStrict(messages);
      } catch (error) {
        return Response.json({ error: error?.message || "messages invalid" }, { status: 400 });
      }

      const conv = await Conversation.findOneAndUpdate(
        { _id: currentConversationId, userId: auth.userId },
        { $set: { messages: sanitized, updatedAt: Date.now() } },
        { new: true }
      ).select("messages");

      if (!conv) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      storedMessagesForRegenerate = sanitized;
      const lastUserMessage = storedMessagesForRegenerate[storedMessagesForRegenerate.length - 1];
      currentPrompt = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : currentPrompt;
      currentAttachments = extractAttachmentsFromMessage(lastUserMessage);
      currentImages = extractImagesFromMessage(lastUserMessage);
      effectiveHistoryMessages = (limit > 0 ? storedMessagesForRegenerate.slice(0, -1).slice(-limit) : storedMessagesForRegenerate.slice(0, -1));
    } else {
      const safeHistory = Array.isArray(history) ? history : [];
      effectiveHistoryMessages = limit > 0 ? safeHistory.slice(-limit) : safeHistory;
    }

    if (!isResume) {
      const userMessageParts = buildUserMessageParts({
        prompt: currentPrompt,
        images: currentImages,
        attachments: currentAttachments,
      });

      if (!isRegenerateMode && userMessageParts.length === 0) {
        return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
      }

      if (!isRegenerateMode) {
        await Conversation.findOneAndUpdate(
          { _id: currentConversationId, userId: auth.userId },
          {
            $push: {
              messages: {
                id: userMessageId,
                role: "user",
                content: currentPrompt,
                type: "parts",
                parts: userMessageParts,
              },
            },
            updatedAt: Date.now(),
          }
        );
      }
    }

    const encoder = new TextEncoder();
    let timeline = [];
    let citations = [];
    let fullText = "";
    let latestAgentRun = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        const sendEvent = (payload) => {
          if (payload?.type === "text" && typeof payload.content === "string") {
            fullText += payload.content;
          } else if (payload?.type === "citations" && Array.isArray(payload.citations)) {
            citations = payload.citations;
          } else if (payload?.type === "agent_status") {
            latestAgentRun = {
              ...(latestAgentRun || {}),
              ...(payload || {}),
            };
          } else if (payload?.type === "agent_step") {
            const step = createTimelineStepFromAgentEvent(payload.step);
            if (step) {
              timeline = pushOrReplaceTimelineStep(timeline, step);
            }
          } else if (payload?.type === "search_start") {
            timeline = pushOrReplaceTimelineStep(timeline, {
              id: `search_${payload.round || Date.now()}`,
              kind: "search",
              status: "running",
              query: payload.query || "",
              title: "联网搜索中",
            });
          } else if (payload?.type === "search_result") {
            timeline = pushOrReplaceTimelineStep(timeline, {
              id: `search_${payload.round || Date.now()}`,
              kind: "search",
              status: "done",
              query: payload.query || "",
              title: "联网搜索完成",
              resultCount: Array.isArray(payload.results) ? payload.results.length : 0,
            });
          } else if (payload?.type === "search_error") {
            timeline = pushOrReplaceTimelineStep(timeline, {
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
          const result = await runAgentRuntime({
            apiKey,
            req,
            userId: auth.userId,
            conversationId: currentConversationId,
            model,
            prompt: currentPrompt,
            historyMessages: effectiveHistoryMessages,
            config,
            attachments: currentAttachments,
            images: currentImages,
            runId,
            resume: isResume,
            approvalDecision,
            sendEvent,
          });

          const fallbackContent = result.status === "waiting_user"
            ? (latestAgentRun?.approvalReason || "Vectaix Agent 已暂停，等待你确认后继续执行。")
            : (fullText || "任务已完成。");

          await Conversation.findOneAndUpdate(
            { _id: currentConversationId, userId: auth.userId },
            {
              $push: {
                messages: {
                  id: modelMessageId,
                  role: "model",
                  content: fallbackContent,
                  type: "text",
                  parts: [{ text: fallbackContent }],
                  citations: citations.length > 0 ? citations : null,
                  thinkingTimeline: timeline,
                  agentRun: latestAgentRun ? {
                    runId: latestAgentRun.runId,
                    status: latestAgentRun.status,
                    currentStep: latestAgentRun.currentStep,
                    canResume: latestAgentRun.canResume === true,
                    lastError: latestAgentRun.lastError || "",
                    approvalReason: latestAgentRun.approvalReason || "",
                    approvalStatus: latestAgentRun.approvalStatus || "",
                  } : undefined,
                },
              },
              updatedAt: Date.now(),
            }
          );

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "stream_error",
            message: error?.message || "Unknown error",
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    const headers = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Conversation-Id": currentConversationId,
    };

    return new Response(responseStream, { headers });
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
