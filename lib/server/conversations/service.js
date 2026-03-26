import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import { sanitizeConversationBody } from "@/lib/server/conversations/sanitize";
import { enrichStoredMessagesWithBlobIds } from "@/lib/server/conversations/blobReferences";

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
  if (Array.isArray(update.messages) && update.messages.length > 0) {
    update.messages = await enrichStoredMessagesWithBlobIds(update.messages, { userId });
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
