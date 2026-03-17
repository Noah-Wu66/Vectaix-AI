import Conversation from "@/models/Conversation";
import ChatRun from "@/models/ChatRun";
import AgentRun from "@/models/AgentRun";
import { REALTIME_EVENTS, ACTIVE_AGENT_RUN_STATUSES, ACTIVE_CHAT_RUN_STATUSES } from "@/lib/shared/realtime";
import { triggerConversationEvent, triggerUserEvent } from "@/lib/server/realtime/pusher";

function toPlainMessage(message) {
  if (!message) return null;
  return message?.toObject ? message.toObject() : { ...message };
}

function toIsoString(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

async function resolveHasActiveRun(conversationId, userId) {
  const [chatExists, agentExists] = await Promise.all([
    ChatRun.exists({ conversationId, userId, status: { $in: ACTIVE_CHAT_RUN_STATUSES } }),
    AgentRun.exists({ conversationId, userId, status: { $in: ACTIVE_AGENT_RUN_STATUSES } }),
  ]);
  return Boolean(chatExists || agentExists);
}

function buildConversationPayload(conversation, hasActiveRun) {
  return {
    conversationId: conversation?._id?.toString?.() || String(conversation?._id || ""),
    title: typeof conversation?.title === "string" ? conversation.title : "",
    model: typeof conversation?.model === "string" ? conversation.model : "",
    pinned: conversation?.pinned === true,
    updatedAt: toIsoString(conversation?.updatedAt),
    hasActiveRun: hasActiveRun === true,
  };
}

export async function publishConversationUpsert({
  conversationId,
  userId,
  conversation = null,
  hasActiveRun = null,
}) {
  const targetConversation = conversation || await Conversation.findOne({ _id: conversationId, userId })
    .select("title model pinned updatedAt")
    .lean();
  if (!targetConversation) return;
  const nextHasActiveRun = typeof hasActiveRun === "boolean"
    ? hasActiveRun
    : await resolveHasActiveRun(targetConversation._id, userId);
  await triggerUserEvent(
    userId,
    REALTIME_EVENTS.conversationUpsert,
    buildConversationPayload(targetConversation, nextHasActiveRun),
  );
}

export async function publishConversationRemove({ conversationId, userId }) {
  await triggerUserEvent(userId, REALTIME_EVENTS.conversationRemove, {
    conversationId: String(conversationId || ""),
  });
}

export async function publishMessageUpsert({
  conversationId,
  userId,
  messageId,
  message = null,
}) {
  let targetMessage = toPlainMessage(message);
  if (!targetMessage && messageId) {
    const conversation = await Conversation.findOne({ _id: conversationId, userId }).select("messages");
    if (!conversation) return;
    const matched = Array.isArray(conversation.messages)
      ? conversation.messages.find((item) => item?.id === messageId)
      : null;
    targetMessage = toPlainMessage(matched);
  }
  if (!targetMessage) return;
  await triggerConversationEvent(conversationId, REALTIME_EVENTS.messageUpsert, {
    conversationId: String(conversationId || ""),
    message: targetMessage,
  });
}

export async function publishMessageRemove({ conversationId, messageId }) {
  await triggerConversationEvent(conversationId, REALTIME_EVENTS.messageRemove, {
    conversationId: String(conversationId || ""),
    messageId: String(messageId || ""),
  });
}

export async function publishRunStatus({
  conversationId,
  runId,
  runType,
  messageId,
  status,
  phase,
  updatedAt,
}) {
  await triggerConversationEvent(conversationId, REALTIME_EVENTS.runStatus, {
    conversationId: String(conversationId || ""),
    runId: String(runId || ""),
    runType: String(runType || ""),
    messageId: String(messageId || ""),
    status: String(status || ""),
    phase: String(phase || ""),
    updatedAt: toIsoString(updatedAt) || new Date().toISOString(),
  });
}
