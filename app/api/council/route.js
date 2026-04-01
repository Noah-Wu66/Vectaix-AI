import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { buildContextSafeHistoryMessages, generateMessageId, sanitizeStoredMessagesStrict } from "@/app/api/chat/utils";
import {
  COUNCIL_MAX_ROUNDS,
  COUNCIL_MODEL_ID,
  countCompletedCouncilRounds,
  modelSupportsAvailableInput,
} from "@/lib/shared/models";
import { resolveCouncilProviderRoutes } from "@/lib/modelRoutes";
import {
  buildCouncilExpertState,
  buildCouncilFinalMessage,
  buildCouncilHistoryMemo,
  buildCouncilSummaryState,
  buildCouncilUserInput,
  buildCouncilUserInputFromMessage,
  COUNCIL_EXPERT_CONFIGS,
  createCouncilStreamHelpers,
  runCouncilExpert,
  runSeedCouncilSummary,
  runSeedTriage,
} from "./councilHelpers";
import {
  enrichConversationPartsWithBlobIds,
  enrichStoredMessagesWithBlobIds,
} from "@/lib/server/conversations/blobReferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const MAX_REQUEST_BYTES = 2_000_000;
const MAX_COUNCIL_EXPERTS = 3;
const MAX_EXPERT_MODEL_CHARS = 100;
const MAX_EXPERT_LABEL_CHARS = 120;
const MAX_EXPERT_CONTENT_CHARS = 20000;
const CONVERSATION_WRITE_CONFLICT_ERROR = "当前对话已被其他请求更新，请重试";

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildConversationWriteCondition(conversationId, userId, writePermitTime) {
  const condition = { _id: conversationId, userId };
  if (Number.isFinite(writePermitTime)) {
    condition.updatedAt = { $lte: new Date(writePermitTime) };
  }
  return condition;
}

function sanitizeCouncilExperts(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_COUNCIL_EXPERTS) {
    throw new Error(`${fieldPath} too many`);
  }
  const experts = [];
  for (const [index, expert] of value.entries()) {
    if (!isPlainObject(expert)) continue;
    const modelId = typeof expert.modelId === "string" ? expert.modelId.trim() : "";
    const label = typeof expert.label === "string" ? expert.label.trim() : "";
    const content = typeof expert.content === "string" ? expert.content : "";
    if (!modelId || modelId.length > MAX_EXPERT_MODEL_CHARS) {
      throw new Error(`${fieldPath}[${index}].modelId invalid`);
    }
    if (!label || label.length > MAX_EXPERT_LABEL_CHARS) {
      throw new Error(`${fieldPath}[${index}].label invalid`);
    }
    if (!content || content.length > MAX_EXPERT_CONTENT_CHARS) {
      throw new Error(`${fieldPath}[${index}].content invalid`);
    }
    const nextExpert = { modelId, label, content };
    if (Array.isArray(expert.citations) && expert.citations.length > 0) {
      nextExpert.citations = expert.citations;
    }
    experts.push(nextExpert);
  }
  return experts;
}

async function sanitizeCouncilRegenerateMessages(messages, userId) {
  const sanitized = sanitizeStoredMessagesStrict(messages);
  const enrichedMessages = await enrichStoredMessagesWithBlobIds(sanitized, { userId });
  return enrichedMessages.map((message, index) => {
    const original = messages[index];
    const nextMessage = { ...message };
    const experts = sanitizeCouncilExperts(original?.councilExperts, `messages[${index}].councilExperts`);
    if (experts.length > 0) {
      nextMessage.councilExperts = experts;
    }
    return nextMessage;
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
    mode,
    messages,
  } = body || {};
  const requestImages = Array.isArray(config?.images) ? config.images : [];
  const requestAttachments = Array.isArray(config?.attachments) ? config.attachments : [];

  if (model !== COUNCIL_MODEL_ID) {
    return Response.json({ error: "Council 模式请求无效" }, { status: 400 });
  }
  if (!Array.isArray(history)) {
    return Response.json({ error: "history must be an array" }, { status: 400 });
  }

  if (mode) {
    return Response.json({ error: "Council 模式不支持该操作" }, { status: 400 });
  }
  const isRegenerateMode = false;
  if (requestImages.length > 0 && !modelSupportsAvailableInput(COUNCIL_MODEL_ID, "image")) {
    return Response.json({ error: "Council 当前不支持图片输入" }, { status: 400 });
  }
  if (requestAttachments.length > 0) {
    return Response.json({ error: "Council 当前只支持文字和图片输入" }, { status: 400 });
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

  let providerRoutes;
  try {
    providerRoutes = resolveCouncilProviderRoutes();
  } catch (error) {
    return Response.json({ error: error?.message || "模型线路配置错误" }, { status: 500 });
  }

  let promptText = typeof prompt === "string" ? prompt : "";
  let councilInput = null;
  let currentConversation = null;
  let createdConversationForRequest = false;

  if (!isRegenerateMode && conversationId == null) {
    if (!promptText.trim() && requestImages.length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    try {
      councilInput = await buildCouncilUserInput({
        prompt: promptText,
        images: requestImages,
      });
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
      return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
    }
  }

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
  }

  if (!currentConversation) {
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

  if (!currentConversation) {
    return Response.json({ error: "conversationId missing" }, { status: 400 });
  }

  const currentConversationId = currentConversation._id.toString();
  const previousMessages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
  const safeRequestHistory = buildContextSafeHistoryMessages(history);
  const previousUpdatedAt = currentConversation.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
  const resolvedUserMessageId = normalizeMessageId(userMessageId);
  const resolvedModelMessageId = normalizeMessageId(modelMessageId);
  let historyMemo = "";
  let writePermitTime = previousUpdatedAt?.getTime?.();

  if (isRegenerateMode) {
    let sanitizedMessages;
    try {
      sanitizedMessages = await sanitizeCouncilRegenerateMessages(messages, auth.userId);
    } catch (error) {
      return Response.json({ error: error?.message || "Council 快照无效" }, { status: 400 });
    }
    if (sanitizedMessages.length === 0) {
      return Response.json({ error: "Council 快照不能为空" }, { status: 400 });
    }

    const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return Response.json({ error: "Council 重开快照必须以用户消息结尾" }, { status: 400 });
    }

    try {
      councilInput = await buildCouncilUserInputFromMessage(lastMessage);
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
      return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
    }

    promptText = councilInput.prompt || "";
    historyMemo = buildCouncilHistoryMemo(sanitizedMessages.slice(0, -1));

    const regenerateTime = Date.now();
    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: currentConversationId, userId: auth.userId },
      {
        $set: {
          messages: sanitizedMessages,
          updatedAt: regenerateTime,
        },
      },
      { new: true }
    ).select("updatedAt");
    if (!updatedConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? regenerateTime;
  } else {
    const completedRounds = countCompletedCouncilRounds(previousMessages);
    if (completedRounds >= COUNCIL_MAX_ROUNDS) {
      return Response.json(
        { error: `Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。` },
        { status: 400 }
      );
    }

    if (!councilInput) {
      if (!promptText.trim() && requestImages.length === 0) {
        return Response.json({ error: "Prompt is required" }, { status: 400 });
      }
      try {
        councilInput = await buildCouncilUserInput({
          prompt: promptText,
          images: requestImages,
        });
      } catch (error) {
        return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
      }
      if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
        return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
      }
    }

    historyMemo = buildCouncilHistoryMemo(previousMessages);

    const enrichedUserParts = await enrichConversationPartsWithBlobIds(councilInput.userParts, {
      userId: auth.userId,
    });

    const storedUserMessage = {
      id: resolvedUserMessageId,
      role: "user",
      content: promptText,
      type: "parts",
      parts: enrichedUserParts,
    };

    const userMsgTime = Date.now();
    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: currentConversationId, userId: auth.userId },
      {
        $set: { updatedAt: userMsgTime },
        $push: { messages: storedUserMessage },
      },
      { new: true }
    ).select("updatedAt");
    if (!updatedConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? userMsgTime;
  }

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
      let finalMessagePersisted = false;
      const councilSignal = req?.signal;
      const rollbackCouncilTurn = async () => {
        if (finalMessagePersisted) return;

        const writeCondition = buildConversationWriteCondition(
          currentConversationId,
          auth.userId,
          writePermitTime
        );

        if (createdConversationForRequest) {
          await Conversation.deleteOne(writeCondition);
          return;
        }

        if (isRegenerateMode) {
          await Conversation.findOneAndUpdate(
            writeCondition,
            {
              $set: {
                messages: previousMessages,
                updatedAt: previousUpdatedAt,
              },
            }
          );
          return;
        }

        await Conversation.findOneAndUpdate(
          writeCondition,
          {
            $pull: {
              messages: { id: resolvedUserMessageId },
            },
            $set: {
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

        // ── Seed Triage：预判是否需要启动 Council ──
        const hasImages = Array.isArray(councilInput.imagePayloads) && councilInput.imagePayloads.length > 0;
        const skipTriage = isRegenerateMode || hasImages;
        let triageResult = { needCouncil: true };

        if (!skipTriage) {
          triageResult = await runSeedTriage({ prompt: promptText, hasImages, signal: councilSignal });
        }

        if (!triageResult.needCouncil && triageResult.directAnswer) {
          // ── 简单问题：跳过专家，Seed 直接回答 ──
          for (const expert of COUNCIL_EXPERT_CONFIGS) {
            updateExpertState(expert, {
              status: "skipped",
              phase: "skipped",
              message: "已跳过",
            });
          }

          streamHelpers.sendCouncilTriage({ skipped: true });

          updateSummaryState({
            status: "running",
            phase: "answering",
            message: "回答中",
          });

          // 模拟流式输出 directAnswer
          const answer = triageResult.directAnswer;
          const CHUNK_SIZE = 4;
          for (let i = 0; i < answer.length; i += CHUNK_SIZE) {
            streamHelpers.sendText(answer.slice(i, i + CHUNK_SIZE));
            if (i + CHUNK_SIZE < answer.length) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }

          if (clientAborted) {
            throw new Error("COUNCIL_ABORTED");
          }

          const finalMessage = buildCouncilFinalMessage({
            modelMessageId: resolvedModelMessageId,
            content: answer,
            experts: [],
          });

          const persistedConversation = await Conversation.findOneAndUpdate(
            buildConversationWriteCondition(currentConversationId, auth.userId, writePermitTime),
            {
              $set: { updatedAt: Date.now() },
              $push: { messages: finalMessage },
            },
            { new: true }
          ).select("updatedAt");
          if (!persistedConversation) {
            throw new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
          }
          finalMessagePersisted = true;
          writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();

          streamHelpers.sendCitations(finalMessage.citations);
          updateSummaryState({
            status: "done",
            phase: "done",
            message: "已完成",
          });
          streamHelpers.sendDone();
          controller.close();
          return;
        }

        // ── 复杂问题：走完整 Council 流程 ──
        const experts = await Promise.all(
          COUNCIL_EXPERT_CONFIGS.map((expert) =>
            runCouncilExpert({
              prompt: promptText,
              historyMemo,
              imagePayloads: councilInput.imagePayloads,
              expert,
              userId: auth.userId,
              conversationId: currentConversationId,
              clientAborted: () => clientAborted,
              updateStatus: (patch) => updateExpertState(expert, patch),
              providerRoutes,
              history: safeRequestHistory,
              signal: councilSignal,
              onDone: (result) => {
                try {
                  streamHelpers.sendCouncilExpertResult(result);
                } catch {
                  // ignore
                }
              },
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
          historyMemo,
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
          signal: councilSignal,
        });

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        const finalMessage = buildCouncilFinalMessage({
          modelMessageId: resolvedModelMessageId,
          content: summary,
          experts,
        });

        const persistedConversation = await Conversation.findOneAndUpdate(
          buildConversationWriteCondition(currentConversationId, auth.userId, writePermitTime),
          {
            $set: { updatedAt: Date.now() },
            $push: { messages: finalMessage },
          },
          { new: true }
        ).select("updatedAt");
        if (!persistedConversation) {
          throw new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
        }
        finalMessagePersisted = true;
        writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();

        streamHelpers.sendCouncilExperts(experts);
        streamHelpers.sendCitations(finalMessage.citations);
        updateSummaryState({
          status: "done",
          phase: "done",
          message: "已完成",
        });
        streamHelpers.sendDone();
        controller.close();
      } catch (error) {
        try {
          streamHelpers.sendCouncilSummaryState(buildCouncilSummaryState({
            status: "error",
            phase: "error",
            message: error?.message === "COUNCIL_ABORTED"
              ? "已停止"
              : (error?.message || "执行失败"),
          }));
        } catch {
          // ignore stream state send failure
        }
        try {
          await rollbackCouncilTurn();
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
