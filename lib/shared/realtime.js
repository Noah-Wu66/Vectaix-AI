export const REALTIME_EVENTS = Object.freeze({
  conversationUpsert: "conversation.upsert",
  conversationRemove: "conversation.remove",
  messageUpsert: "message.upsert",
  messageRemove: "message.remove",
  runStatus: "run.status",
});

export const ACTIVE_CHAT_RUN_STATUSES = Object.freeze(["queued", "running"]);
export const ACTIVE_AGENT_RUN_STATUSES = Object.freeze(["running", "waiting_continue", "awaiting_approval"]);

export function getUserChannelName(userId) {
  return `private-user-${String(userId || "")}`;
}

export function getConversationChannelName(conversationId) {
  return `private-conversation-${String(conversationId || "")}`;
}

export function getUserIdFromChannelName(channelName) {
  const value = typeof channelName === "string" ? channelName.trim() : "";
  if (!value.startsWith("private-user-")) return "";
  return value.slice("private-user-".length);
}

export function getConversationIdFromChannelName(channelName) {
  const value = typeof channelName === "string" ? channelName.trim() : "";
  if (!value.startsWith("private-conversation-")) return "";
  return value.slice("private-conversation-".length);
}
