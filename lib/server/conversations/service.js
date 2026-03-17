import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import { sanitizeConversationBody } from "@/lib/server/conversations/sanitize";
import ChatRun from "@/models/ChatRun";
import AgentRun from "@/models/AgentRun";
import { killSandboxSession } from "@/lib/server/sandbox/vercelSandbox";

export function isValidConversationId(id) {
  return mongoose.isValidObjectId(id);
}

export async function getConversationForUser(id, userId) {
  return Conversation.findOne({ _id: id, userId }).lean();
}

export async function deleteConversationForUser(id, userId) {
  const activeAgentRuns = await AgentRun.find({
    conversationId: id,
    userId,
    status: { $in: ["running", "waiting_continue", "awaiting_approval"] },
  }).select("_id sandboxSession");

  await Promise.all(
    activeAgentRuns.map((run) => killSandboxSession(run?.sandboxSession).catch(() => null))
  );

  await Promise.all([
    ChatRun.updateMany(
      { conversationId: id, userId, status: { $in: ["queued", "running"] } },
      {
        $set: {
          status: "cancelled",
          phase: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: "",
        },
      }
    ),
    AgentRun.updateMany(
      { conversationId: id, userId, status: { $in: ["running", "waiting_continue", "awaiting_approval"] } },
      {
        $set: {
          status: "cancelled",
          executionState: "cancelled",
          failureReason: "对话已删除",
          sandboxSession: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    ),
  ]);

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
