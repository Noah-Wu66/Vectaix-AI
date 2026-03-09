import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { generateMessageId } from "@/app/api/chat/utils";
import { COUNCIL_MODEL_ID } from "@/app/lib/councilModel";
import {
  buildCouncilExpertState,
  buildCouncilFinalMessage,
  buildCouncilSummaryState,
  buildCouncilUserInput,
  COUNCIL_EXPERT_CONFIGS,
  createCouncilStreamHelpers,
  runCouncilExpert,
  runSeedCouncilSummary,
} from "./councilHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;

function buildTitle(prompt) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) return "Council";
  return text.length > 30 ? `${text.slice(0, 30)}...` : text;
}

function normalizeMessageId(value) {
  return typeof value === "string" && value.trim() && value.length <= 128
    ? value.trim()
    : generateMessageId();
}

function createStreamErrorEvent(message) {
  return JSON.stringify({
    type: "stream_error",
    message: message || "Unknown error",
  });
}

export async function POST(req) {
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
    conversationId,
    userMessageId,
    modelMessageId,
    history,
  } = body || {};

  if (model !== COUNCIL_MODEL_ID) {
    return Response.json({ error: "Council 模式请求无效" }, { status: 400 });
  }
  if (!Array.isArray(history)) {
    return Response.json({ error: "history must be an array" }, { status: 400 });
  }
  if (history.length > 0) {
    return Response.json({ error: "Council 只支持单轮新对话" }, { status: 400 });
  }

  const promptText = typeof prompt === "string" ? prompt : "";
  const imageConfigs = Array.isArray(config?.images) ? config.images : [];
  if (!promptText.trim() && imageConfigs.length === 0) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
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

  const userDoc = await User.findById(auth.userId).select("_id");
  if (!userDoc) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let councilInput;
  try {
    councilInput = await buildCouncilUserInput({
      prompt: promptText,
      images: imageConfigs,
    });
  } catch (error) {
    return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
  }

  if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
    return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
  }

  let currentConversation = null;
  let createdConversationForRequest = false;
  if (conversationId != null) {
    if (!mongoose.isValidObjectId(conversationId)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    currentConversation = await Conversation.findOne({
      _id: conversationId,
      userId: auth.userId,
    }).lean();
    if (!currentConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (currentConversation.model !== COUNCIL_MODEL_ID) {
      return Response.json({ error: "Council 对话不存在" }, { status: 400 });
    }
    if (Array.isArray(currentConversation.messages) && currentConversation.messages.length > 0) {
      return Response.json({ error: "Council 已结束，请新建对话" }, { status: 409 });
    }
  } else {
    const createdConversation = await Conversation.create({
      userId: auth.userId,
      title: buildTitle(promptText),
      model: COUNCIL_MODEL_ID,
      messages: [],
      settings: {},
    });
    currentConversation = createdConversation.toObject();
    createdConversationForRequest = true;
  }

  const currentConversationId = currentConversation._id.toString();
  const previousMessages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
  const previousUpdatedAt = currentConversation.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
  const resolvedUserMessageId = normalizeMessageId(userMessageId);
  const resolvedModelMessageId = normalizeMessageId(modelMessageId);

  const storedUserMessage = {
    id: resolvedUserMessageId,
    role: "user",
    content: promptText,
    type: "parts",
    parts: councilInput.userParts,
  };

  await Conversation.findOneAndUpdate(
    { _id: currentConversationId, userId: auth.userId },
    {
      $set: { updatedAt: new Date() },
      $push: { messages: storedUserMessage },
    }
  );

  let clientAborted = false;
  const onAbort = () => {
    clientAborted = true;
  };
  try {
    req?.signal?.addEventListener?.("abort", onAbort, { once: true });
  } catch {
    // ignore
  }

  const responseStream = new ReadableStream({
    async start(controller) {
      const streamHelpers = createCouncilStreamHelpers(controller);
      const restoreConversationSnapshot = async () => {
        if (createdConversationForRequest || previousMessages.length === 0) {
          await Conversation.deleteOne({ _id: currentConversationId, userId: auth.userId });
          return;
        }
        await Conversation.findOneAndUpdate(
          { _id: currentConversationId, userId: auth.userId },
          {
            $set: {
              messages: previousMessages,
              updatedAt: previousUpdatedAt,
            },
          }
        );
      };

      try {
        const expertStateMap = new Map(
          COUNCIL_EXPERT_CONFIGS.map((expert) => [expert.key, buildCouncilExpertState(expert, {
            status: "pending",
            phase: "pending",
            message: "等待开始",
          })])
        );
        let summaryState = buildCouncilSummaryState({
          status: "pending",
          phase: "pending",
          message: "等待三位专家完成",
        });

        streamHelpers.sendCouncilExpertStates(Array.from(expertStateMap.values()));

        const updateExpertState = (expert, patch) => {
          const nextState = buildCouncilExpertState(expert, {
            ...expertStateMap.get(expert.key),
            ...patch,
          });
          expertStateMap.set(expert.key, nextState);
          try {
            streamHelpers.sendCouncilExpertState(nextState);
          } catch {
            // ignore stream state send failure
          }
        };

        const updateSummaryState = (patch) => {
          summaryState = buildCouncilSummaryState({
            ...summaryState,
            ...patch,
          });
          try {
            streamHelpers.sendCouncilSummaryState(summaryState);
          } catch {
            // ignore stream state send failure
          }
        };

        const experts = await Promise.all(
          COUNCIL_EXPERT_CONFIGS.map((expert) =>
            runCouncilExpert({
              prompt: promptText,
              imagePayloads: councilInput.imagePayloads,
              expert,
              conversationId: currentConversationId,
              clientAborted: () => clientAborted,
              updateStatus: (patch) => updateExpertState(expert, patch),
            })
          )
        );

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        streamHelpers.sendCouncilSummaryState(summaryState);
        await new Promise((resolve) => setTimeout(resolve, 100));

        updateSummaryState({
          status: "running",
          phase: "thinking",
          message: "思考中",
        });

        let hasStartedStreaming = false;
        const summary = await runSeedCouncilSummary({
          prompt: promptText,
          experts,
          onTextDelta: (delta) => {
            if (!hasStartedStreaming) {
              hasStartedStreaming = true;
              updateSummaryState({
                status: "running",
                phase: "answering",
                message: "回答中",
              });
            }
            streamHelpers.sendText(delta);
          },
          signal: req?.signal,
        });

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        const finalMessage = buildCouncilFinalMessage({
          modelMessageId: resolvedModelMessageId,
          content: summary,
          experts,
        });

        await Conversation.findOneAndUpdate(
          { _id: currentConversationId, userId: auth.userId },
          {
            $set: { updatedAt: new Date() },
            $push: { messages: finalMessage },
          }
        );

        streamHelpers.sendCouncilExperts(experts);
        streamHelpers.sendCitations(finalMessage.citations);
        updateSummaryState({
          status: "done",
          phase: "done",
          message: "已完成汇总",
        });
        streamHelpers.sendDone();
        controller.close();
      } catch (error) {
        try {
          streamHelpers.sendCouncilSummaryState(buildCouncilSummaryState({
            status: "error",
            phase: "error",
            message: error?.message === "COUNCIL_ABORTED" ? "已停止" : (error?.message || "执行失败"),
          }));
        } catch {
          // ignore stream state send failure
        }
        try {
          await restoreConversationSnapshot();
        } catch {
          // ignore rollback failure
        }
        if (clientAborted || error?.message === "COUNCIL_ABORTED") {
          try {
            controller.close();
          } catch {
            // ignore
          }
          return;
        }
        try {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${createStreamErrorEvent(error?.message || "Council 执行失败")}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.error(error);
        }
      } finally {
        try {
          req?.signal?.removeEventListener?.("abort", onAbort);
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Conversation-Id": currentConversationId,
    },
  });
}
