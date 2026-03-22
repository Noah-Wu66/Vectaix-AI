import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import { sanitizeConversationBody } from "@/lib/server/conversations/sanitize";
import { AGENT_MODEL_ID } from "@/lib/shared/models";

export function isValidConversationId(id) {
  return mongoose.isValidObjectId(id);
}

export async function getConversationForUser(id, userId) {
  return Conversation.findOne({ _id: id, userId }).lean();
}

export async function deleteConversationForUser(id, userId) {
  await Conversation.deleteOne({ _id: id, userId });
}

export async function updateConversationForUser(id, userId, body) {
  const currentConversation = await Conversation.findOne({ _id: id, userId }).select("model");
  if (!currentConversation) {
    return null;
  }

  const update = sanitizeConversationBody(body);
  const effectiveModel = typeof update.model === "string" && update.model
    ? update.model
    : currentConversation.model;

  if (effectiveModel === AGENT_MODEL_ID) {
    delete update["settings.activePromptId"];
  }

  if (Object.keys(update).length === 0) {
    return Conversation.findOne({ _id: id, userId });
  }
  return Conversation.findOneAndUpdate(
    { _id: id, userId },
    { $set: update },
    { new: true }
  );
}
