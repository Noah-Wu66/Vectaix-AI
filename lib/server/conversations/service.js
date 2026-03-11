import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import { sanitizeConversationBody } from "@/lib/server/conversations/sanitize";

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
  const update = sanitizeConversationBody(body);
  if (Object.keys(update).length === 0) {
    return Conversation.findOne({ _id: id, userId });
  }
  return Conversation.findOneAndUpdate(
    { _id: id, userId },
    { $set: update },
    { new: true }
  );
}
