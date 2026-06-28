import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import { generateMessageId, sanitizeStoredMessagesStrict } from "@/app/api/chat/utils";
import {
  FUSION_MAX_ROUNDS,
  FUSION_MODEL_ID,
  countCompletedFusionRounds,
} from "@/lib/shared/models";
import {
  buildFusionFinalMessage,
  buildFusionHistoryMemo,
  buildFusionResultState,
  buildFusionUserInput,
  buildFusionUserInputFromMessage,
  parseNativeFusionMarkdown,
  runFusionAnswer,
  runFusionTriage,
} from "./fusionHelpers";
import { createFusionStreamHelpers } from "./streamHelpers";
import {
  enrichConversationPartsWithBlobIds,
  enrichStoredMessagesWithBlobIds,
} from "@/lib/server/conversations/blobReferences";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
} from "@/app/api/chat/conversationState";
import {
  CHAT_RATE_LIMIT,
  MAX_REQUEST_BYTES,
} from "@/lib/server/chat/routeConstants";
import {
  buildSseResponseHeaders,
  requireChatUser,
} from "@/lib/server/chat/routeHelpers";
import { assertRequestSize, parseJsonRequest } from "@/lib/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FUSION_EXPERTS = 3;
const MAX_EXPERT_MODEL_CHARS = 100;
const MAX_EXPERT_LABEL_CHARS = 120;
const MAX_EXPERT_CONTENT_CHARS = 20000;
const MAX_ANALYSIS_ITEM_CHARS = 2000;
const FUSION_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const FUSION_ANALYSIS_MODELS = new Set(["GPT", "Claude", "Gemini"]);

function buildTitle(prompt) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) return "Fusion";
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

function sanitizeFusionExperts(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_FUSION_EXPERTS) {
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
    if (Number.isFinite(expert.durationMs) && expert.durationMs >= 0) {
      nextExpert.durationMs = Math.max(0, Math.floor(expert.durationMs));
    }
    if (Array.isArray(expert.citations) && expert.citations.length > 0) {
      nextExpert.citations = expert.citations;
    }
    experts.push(nextExpert);
  }
  return experts;
}

function sanitizeFusionAnalysis(value, fieldPath) {
  if (!isPlainObject(value)) return null;
  const result = {};

  for (const key of FUSION_ANALYSIS_GROUP_KEYS) {
    const rawItems = Array.isArray(value[key]) ? value[key] : [];
    result[key] = rawItems
      .filter((item) => isPlainObject(item))
      .map((item, index) => {
        const text = typeof item.text === "string" ? item.text.trim().slice(0, MAX_ANALYSIS_ITEM_CHARS) : "";
        if (!text) {
          throw new Error(`${fieldPath}.${key}[${index}].text invalid`);
        }
        const models = Array.isArray(item.models)
          ? Array.from(new Set(
            item.models
              .filter((model) => typeof model === "string")
              .map((model) => model.trim())
              .filter((model) => FUSION_ANALYSIS_MODELS.has(model))
          ))
          : [];
        return { text, models };
      });
  }

  return result;
}

async function sanitizeFusionRegenerateMessages(messages, userId) {
  const sanitized = sanitizeStoredMessagesStrict(messages);
  const enrichedMessages = await enrichStoredMessagesWithBlobIds(sanitized, { userId });
  return enrichedMessages.map((message, index) => {
    const original = messages[index];
    const nextMessage = { ...message };
    const experts = sanitizeFusionExperts(original?.fusionExperts, `messages[${index}].fusionExperts`);
    if (experts.length > 0) {
      nextMessage.fusionExperts = experts;
    }
    const analysis = sanitizeFusionAnalysis(original?.fusionAnalysis, `messages[${index}].fusionAnalysis`);
    if (analysis) {
      nextMessage.fusionAnalysis = analysis;
    }
    return nextMessage;
  });
}

export async function POST(req) {
  await dbConnect();

  const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
  if (oversizeResponse) return oversizeResponse;

  const parsed = await parseJsonRequest(req, "Invalid JSON in request body");
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

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

  if (model !== FUSION_MODEL_ID) {
    return Response.json({ error: "Fusion 模式请求无效" }, { status: 400 });
  }
  if (!Array.isArray(history)) {
    return Response.json({ error: "history must be an array" }, { status: 400 });
  }

  if (mode) {
    return Response.json({ error: "Fusion 模式不支持该操作" }, { status: 400 });
  }
  const isRegenerateMode = false;
  if (requestImages.length > 0) {
    return Response.json({ error: "Fusion 当前只支持文字输入" }, { status: 400 });
  }
  if (requestAttachments.length > 0) {
    return Response.json({ error: "Fusion 当前只支持文字输入" }, { status: 400 });
  }

  const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
  if (authResult?.response) return authResult.response;
  const auth = authResult.auth;

  let promptText = typeof prompt === "string" ? prompt : "";
  let fusionInput = null;
  let currentConversation = null;
  let createdConversationForRequest = false;

  if (!isRegenerateMode && conversationId == null) {
    if (!promptText.trim() && requestImages.length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    try {
      fusionInput = await buildFusionUserInput({
        prompt: promptText,
        images: requestImages,
      });
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(fusionInput.userParts) || fusionInput.userParts.length === 0) {
      return Response.json({ error: "Fusion 输入不能为空" }, { status: 400 });
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
    if (currentConversation.model !== FUSION_MODEL_ID) {
      return Response.json({ error: "Fusion 对话不存在" }, { status: 400 });
    }
  }

  if (!currentConversation) {
    const createdConversation = await Conversation.create({
      userId: auth.userId,
      title: buildTitle(promptText),
      model: FUSION_MODEL_ID,
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
  const previousUpdatedAt = currentConversation.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
  const resolvedUserMessageId = normalizeMessageId(userMessageId);
  const resolvedModelMessageId = normalizeMessageId(modelMessageId);
  let historyMemo = "";
  let writePermitTime = previousUpdatedAt?.getTime?.();

  if (isRegenerateMode) {
    let sanitizedMessages;
    try {
      sanitizedMessages = await sanitizeFusionRegenerateMessages(messages, auth.userId);
    } catch (error) {
      return Response.json({ error: error?.message || "Fusion 快照无效" }, { status: 400 });
    }
    if (sanitizedMessages.length === 0) {
      return Response.json({ error: "Fusion 快照不能为空" }, { status: 400 });
    }

    const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return Response.json({ error: "Fusion 重开快照必须以用户消息结尾" }, { status: 400 });
    }

    try {
      fusionInput = await buildFusionUserInputFromMessage(lastMessage);
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(fusionInput.userParts) || fusionInput.userParts.length === 0) {
      return Response.json({ error: "Fusion 输入不能为空" }, { status: 400 });
    }

    promptText = fusionInput.prompt || "";
    historyMemo = buildFusionHistoryMemo(sanitizedMessages.slice(0, -1));

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
    const completedRounds = countCompletedFusionRounds(previousMessages);
    if (completedRounds >= FUSION_MAX_ROUNDS) {
      return Response.json(
        { error: "Fusion 只支持一轮会话，请新建对话继续。" },
        { status: 400 }
      );
    }

    if (!fusionInput) {
      if (!promptText.trim() && requestImages.length === 0) {
        return Response.json({ error: "Prompt is required" }, { status: 400 });
      }
      try {
        fusionInput = await buildFusionUserInput({
          prompt: promptText,
          images: requestImages,
        });
      } catch (error) {
        return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
      }
      if (!Array.isArray(fusionInput.userParts) || fusionInput.userParts.length === 0) {
        return Response.json({ error: "Fusion 输入不能为空" }, { status: 400 });
      }
    }

    historyMemo = buildFusionHistoryMemo(previousMessages);

    const enrichedUserParts = await enrichConversationPartsWithBlobIds(fusionInput.userParts, {
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
      const streamHelpers = createFusionStreamHelpers(controller);
      let finalMessagePersisted = false;
      const fusionSignal = req?.signal;
      const rollbackFusionTurn = async () => {
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

      let resultState = buildFusionResultState({
        status: "pending",
        phase: "pending",
        message: "等待对比分析完成",
      });

      try {
        const hasImages = Array.isArray(fusionInput.imagePayloads) && fusionInput.imagePayloads.length > 0;
        const skipTriage = isRegenerateMode || hasImages;
        let triageResult = { needFusion: true };

        if (!skipTriage) {
          triageResult = await runFusionTriage({ prompt: promptText, hasImages, signal: fusionSignal });
        }

        if (!triageResult.needFusion && triageResult.directAnswer) {
          resultState = buildFusionResultState({
            status: "running",
            phase: "answering",
            message: "正在生成正式回复",
          });
          const answer = triageResult.directAnswer;
          streamHelpers.sendFusionResultState(resultState);

          if (clientAborted) {
            throw new Error("FUSION_ABORTED");
          }

          const finalMessage = buildFusionFinalMessage({
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

          streamHelpers.sendFusionResult(finalMessage.content);
          resultState = buildFusionResultState({
            status: "done",
            phase: "done",
            message: "已完成",
          });
          streamHelpers.sendFusionResultState(resultState);
          streamHelpers.sendDone();
          controller.close();
          return;
        }

        resultState = buildFusionResultState({
          status: "running",
          phase: "answering",
          message: "正在生成正式回复",
        });
        streamHelpers.sendFusionResultState(resultState);

        const { text: rawFusionAnswer, citations: finalCitations } = await runFusionAnswer({
          historyMemo,
          prompt: promptText,
          signal: fusionSignal,
        });
        const parsedFusionAnswer = parseNativeFusionMarkdown(rawFusionAnswer);
        const finalAnswer = parsedFusionAnswer.content || rawFusionAnswer;

        if (clientAborted) {
          throw new Error("FUSION_ABORTED");
        }

        const finalMessage = buildFusionFinalMessage({
          modelMessageId: resolvedModelMessageId,
          content: finalAnswer,
          experts: parsedFusionAnswer.experts,
          analysis: parsedFusionAnswer.analysis,
          citations: finalCitations,
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

        if (parsedFusionAnswer.experts.length > 0) {
          streamHelpers.sendFusionExperts(parsedFusionAnswer.experts);
        }
        if (parsedFusionAnswer.analysis) {
          streamHelpers.sendFusionAnalysisResult(parsedFusionAnswer.analysis);
        }
        streamHelpers.sendFusionResult(finalMessage.content);
        streamHelpers.sendCitations(finalMessage.citations);
        resultState = buildFusionResultState({
          status: "done",
          phase: "done",
          message: "已完成",
        });
        streamHelpers.sendFusionResultState(resultState);
        streamHelpers.sendDone();
        controller.close();
      } catch (error) {
        try {
          const errorMessage = error?.message === "FUSION_ABORTED"
            ? "已停止"
            : (error?.message || "执行失败");
          if (resultState.status === "running" || resultState.phase === "answering") {
            streamHelpers.sendFusionResultState(buildFusionResultState({
              status: "error",
              phase: "error",
              message: errorMessage,
            }));
          }
        } catch {
          // ignore stream state send failure
        }
        try {
          await rollbackFusionTurn();
        } catch {
          // ignore rollback failure
        }
        if (clientAborted || error?.message === "FUSION_ABORTED") {
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
            encoder.encode(`data: ${createStreamErrorEvent(error?.message || "Fusion 执行失败")}\n\n`)
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
    headers: buildSseResponseHeaders(currentConversationId),
  });
}
