import Conversation from "@/models/Conversation";
import ChatRun from "@/models/ChatRun";
import AgentRun from "@/models/AgentRun";
import { generateMessageId, isNonEmptyString, sanitizeStoredMessagesStrict } from "@/app/api/chat/utils";
import { AGENT_MODEL_ID, getModelProvider, isCouncilModel } from "@/lib/shared/models";

export const CHAT_RUN_ACTIVE_STATUSES = Object.freeze(["queued", "running"]);
export const CHAT_RUN_FINISHED_STATUSES = Object.freeze(["completed", "failed", "cancelled"]);

function cloneParts(value) {
  return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
}

function buildUserMessageParts({ prompt, config }) {
  const parts = [];
  if (isNonEmptyString(prompt)) {
    parts.push({ text: prompt });
  }
  for (const image of Array.isArray(config?.images) ? config.images : []) {
    if (!image?.url || !image?.mimeType) continue;
    parts.push({
      inlineData: {
        url: image.url,
        mimeType: image.mimeType,
      },
    });
  }
  for (const file of Array.isArray(config?.attachments) ? config.attachments : []) {
    if (!file?.url || !file?.name || !file?.mimeType || !file?.extension || !file?.category) continue;
    parts.push({
      fileData: {
        url: file.url,
        name: file.name,
        mimeType: file.mimeType,
        size: Number(file.size) || 0,
        extension: file.extension,
        category: file.category,
      },
    });
  }
  return parts;
}

export function isChatRunActive(run) {
  return CHAT_RUN_ACTIVE_STATUSES.includes(String(run?.status || ""));
}

export function buildChatRunMeta(run, extra = {}) {
  return {
    runId: run?._id?.toString?.() || "",
    status: run?.status || "queued",
    phase: run?.phase || "queued",
    provider: run?.provider || "",
    model: run?.model || "",
    errorMessage: run?.errorMessage || "",
    updatedAt: run?.updatedAt ? new Date(run.updatedAt).toISOString() : null,
    ...extra,
  };
}

export function buildRunSummary(run, runType) {
  if (!run) return null;
  const base = {
    runId: run?._id?.toString?.() || "",
    runType,
    conversationId: run?.conversationId?.toString?.() || String(run?.conversationId || ""),
    updatedAt: run?.updatedAt ? new Date(run.updatedAt).toISOString() : null,
    model: run?.model || "",
  };
  if (runType === "chat") {
    return {
      ...base,
      messageId: run.messageId || "",
      status: run.status || "queued",
      phase: run.phase || "queued",
      provider: run.provider || "",
      errorMessage: run.errorMessage || "",
    };
  }
  return {
    ...base,
    messageId: run?.metadata?.messageId || "",
    status: run.status || "running",
    phase: run.executionState || run.status || "running",
    provider: "vectaix",
    errorMessage: run.lastError || run.failureReason || "",
  };
}

function buildPlaceholderMessage({ messageId, model, provider, runType }) {
  const base = {
    id: messageId,
    role: "model",
    content: provider === "council" ? "Council 正在处理中..." : "正在处理中...",
    type: "text",
    parts: [{ text: provider === "council" ? "Council 正在处理中..." : "正在处理中..." }],
  };
  if (runType === "agent") {
    base.agentRun = {
      runId: "",
      status: "queued",
      executionState: "planning",
      currentStep: "准备执行",
      canResume: false,
      updatedAt: new Date().toISOString(),
    };
    return base;
  }
  base.chatRun = {
    runId: "",
    status: "queued",
    phase: "queued",
    provider,
    model,
    errorMessage: "",
    updatedAt: new Date().toISOString(),
  };
  return base;
}

function buildConversationTitle(prompt, config, model) {
  const promptText = isNonEmptyString(prompt) ? prompt.trim() : "";
  if (promptText) return promptText.length > 30 ? `${promptText.slice(0, 30)}...` : promptText;
  const firstAttachment = Array.isArray(config?.attachments) ? config.attachments[0] : null;
  if (firstAttachment?.name) return `附件：${firstAttachment.name}`;
  if (isCouncilModel(model)) return "Council";
  if (model === AGENT_MODEL_ID) return "New Chat";
  return "New Chat";
}

async function appendMessagesToConversation({ conversationId, userId, userMessage, placeholderMessage }) {
  const update = {
    $set: {
      updatedAt: Date.now(),
    },
    $push: {
      messages: {
        $each: [userMessage, placeholderMessage],
      },
    },
  };
  return Conversation.findOneAndUpdate(
    { _id: conversationId, userId },
    update,
    { new: true }
  );
}

export async function createRunRequest({
  userId,
  model,
  prompt,
  config,
  history,
  historyLimit,
  conversationId,
  settings,
  userMessageId: requestedUserMessageId,
  messageId: requestedMessageId,
}) {
  const provider = getModelProvider(model);
  const runType = model === AGENT_MODEL_ID ? "agent" : "chat";
  const userMessageId = typeof requestedUserMessageId === "string" && requestedUserMessageId
    ? requestedUserMessageId
    : generateMessageId();
  const messageId = typeof requestedMessageId === "string" && requestedMessageId
    ? requestedMessageId
    : generateMessageId();
  const userMessageParts = buildUserMessageParts({ prompt, config });
  if (userMessageParts.length === 0) {
    throw new Error("请至少输入内容或上传附件");
  }

  let targetConversationId = conversationId || "";
  if (!targetConversationId) {
    const createdConversation = await Conversation.create({
      userId,
      title: buildConversationTitle(prompt, config, model),
      model,
      settings,
      messages: [],
      updatedAt: new Date(),
    });
    targetConversationId = createdConversation._id.toString();
  }

  const userMessage = {
    id: userMessageId,
    role: "user",
    content: typeof prompt === "string" ? prompt : "",
    type: "parts",
    parts: cloneParts(userMessageParts),
  };
  const placeholderMessage = buildPlaceholderMessage({
    messageId,
    model,
    provider,
    runType,
  });

  await appendMessagesToConversation({
    conversationId: targetConversationId,
    userId,
    userMessage,
    placeholderMessage,
  });

  if (runType === "agent") {
    return {
      runType,
      conversationId: targetConversationId,
      userMessageId,
      messageId,
      provider,
    };
  }

  const createdRun = await ChatRun.create({
    userId,
    conversationId: targetConversationId,
    messageId,
    provider,
    model,
    status: "queued",
    phase: provider === "council" ? "triage" : "queued",
    promptSnapshot: typeof prompt === "string" ? prompt : "",
    historySnapshot: Array.isArray(history) ? history : [],
    configSnapshot: config && typeof config === "object" ? config : {},
    settingsSnapshot: settings && typeof settings === "object" ? settings : null,
    historyLimit: Number.isFinite(Number(historyLimit)) ? Number(historyLimit) : 0,
  });

  await patchConversationMessage({
    conversationId: targetConversationId,
    userId,
    messageId,
    patch: {
      chatRun: buildChatRunMeta(createdRun),
    },
  });

  return {
    runType,
    runId: createdRun._id.toString(),
    conversationId: targetConversationId,
    userMessageId,
    messageId,
    provider,
  };
}

export async function patchConversationMessage({
  conversationId,
  userId,
  messageId,
  patch,
}) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId }).select("messages");
  if (!conversation) return null;
  const nextMessages = Array.isArray(conversation.messages)
    ? conversation.messages.map((item) => (item?.toObject ? item.toObject() : item))
    : [];
  const index = nextMessages.findIndex((item) => item?.id === messageId);
  if (index < 0) return null;
  const current = nextMessages[index] || {};
  nextMessages[index] = {
    ...current,
    ...patch,
    chatRun: patch?.chatRun === undefined
      ? current.chatRun
      : patch.chatRun,
    agentRun: patch?.agentRun === undefined
      ? current.agentRun
      : patch.agentRun,
  };
  await Conversation.updateOne(
    { _id: conversationId, userId },
    { $set: { messages: nextMessages, updatedAt: Date.now() } }
  );
  return nextMessages[index];
}

export async function syncChatRunSnapshot({
  run,
  patch = {},
  conversationPatch = {},
}) {
  const nextRun = await ChatRun.findByIdAndUpdate(
    run._id,
    {
      $set: {
        ...patch,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!nextRun) return null;

  await patchConversationMessage({
    conversationId: nextRun.conversationId,
    userId: nextRun.userId,
    messageId: nextRun.messageId,
    patch: {
      ...conversationPatch,
      chatRun: buildChatRunMeta(nextRun),
    },
  });

  return nextRun;
}

export async function failChatRun(run, errorMessage) {
  const message = typeof errorMessage === "string" && errorMessage.trim()
    ? errorMessage.trim()
    : "任务执行失败";
  return syncChatRunSnapshot({
    run,
    patch: {
      status: "failed",
      phase: "failed",
      errorMessage: message,
      finishedAt: new Date(),
    },
    conversationPatch: {
      content: message,
      parts: [{ text: message }],
    },
  });
}

export async function cancelChatRun(run) {
  return syncChatRunSnapshot({
    run,
    patch: {
      status: "cancelled",
      phase: "cancelled",
      errorMessage: "",
      finishedAt: new Date(),
    },
    conversationPatch: {
      content: "任务已取消。",
      parts: [{ text: "任务已取消。" }],
    },
  });
}

export async function getActiveRunSummaries(userId) {
  const [chatRuns, agentRuns] = await Promise.all([
    ChatRun.find({ userId, status: { $in: CHAT_RUN_ACTIVE_STATUSES } })
      .sort({ updatedAt: -1 })
      .lean(),
    AgentRun.find({
      userId,
      status: { $in: ["running", "waiting_continue", "awaiting_approval"] },
    })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  return [
    ...chatRuns.map((run) => buildRunSummary(run, "chat")),
    ...agentRuns.map((run) => buildRunSummary(run, "agent")),
  ].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

export async function getRunDetail(userId, id) {
  const [chatRun, agentRun] = await Promise.all([
    ChatRun.findOne({ _id: id, userId }).lean().catch(() => null),
    AgentRun.findOne({ _id: id, userId }).lean().catch(() => null),
  ]);
  if (chatRun) {
    return {
      runType: "chat",
      ...buildRunSummary(chatRun, "chat"),
      thoughtText: chatRun.thoughtText || "",
      outputText: chatRun.outputText || "",
      citations: Array.isArray(chatRun.citations) ? chatRun.citations : [],
      searchContextTokens: Number.isFinite(chatRun.searchContextTokens) ? chatRun.searchContextTokens : 0,
      timeline: Array.isArray(chatRun.timeline) ? chatRun.timeline : [],
      councilExperts: Array.isArray(chatRun.councilExperts) ? chatRun.councilExperts : [],
      councilExpertStates: Array.isArray(chatRun.councilExpertStates) ? chatRun.councilExpertStates : [],
      councilSummaryState: chatRun.councilSummaryState || null,
      errorMessage: chatRun.errorMessage || "",
    };
  }
  if (agentRun) {
    return {
      runType: "agent",
      ...buildRunSummary(agentRun, "agent"),
      currentStep: agentRun.currentStep || "",
      executionState: agentRun.executionState || "",
      approvalRequest: agentRun.approvalRequest || null,
      citations: Array.isArray(agentRun.citations) ? agentRun.citations : [],
      artifacts: Array.isArray(agentRun.artifacts) ? agentRun.artifacts : [],
      lastError: agentRun.lastError || "",
      failureReason: agentRun.failureReason || "",
      sandboxSession: agentRun.sandboxSession || null,
    };
  }
  return null;
}

export function sanitizeRegenerateMessages(messages) {
  return sanitizeStoredMessagesStrict(messages);
}
