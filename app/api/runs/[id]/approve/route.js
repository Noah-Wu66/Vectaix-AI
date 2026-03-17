import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import {
  AGENT_EXECUTION_STATES,
  buildAgentMessageMeta,
  generateResumeToken,
} from "@/lib/server/agent/runHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function syncConversationAgentRun({ conversationId, userId, runId, agentRun, content }) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId }).select("messages");
  if (!conversation) return;
  const nextMessages = Array.isArray(conversation.messages)
    ? conversation.messages.map((item) => (item?.toObject ? item.toObject() : item))
    : [];
  const index = nextMessages.findIndex((item) => item?.agentRun?.runId === runId || item?.id === runId);
  if (index < 0) return;
  nextMessages[index] = {
    ...nextMessages[index],
    content: typeof content === "string" ? content : nextMessages[index]?.content,
    parts: [{ text: typeof content === "string" ? content : nextMessages[index]?.content || "" }],
    agentRun,
  };
  await Conversation.updateOne(
    { _id: conversationId, userId },
    { $set: { messages: nextMessages, updatedAt: Date.now() } }
  );
}

export async function POST(request, context) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const run = await AgentRun.findOne({ _id: id, userId: auth.userId });
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (run.executionState !== AGENT_EXECUTION_STATES.awaitingApproval || run?.approvalRequest?.status !== "pending") {
    return Response.json({ error: "当前任务不在等待审批状态，不能执行这个操作。" }, { status: 409 });
  }

  const nextRun = await AgentRun.findByIdAndUpdate(
    run._id,
    {
      $set: {
        status: "waiting_continue",
        executionState: AGENT_EXECUTION_STATES.waitingContinue,
        resumeToken: generateResumeToken(),
        approvalRequest: {
          ...(run.approvalRequest || {}),
          status: "approved",
          decidedAt: new Date(),
        },
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
  const publicRun = buildAgentMessageMeta(nextRun, {
    status: nextRun.status,
    executionState: nextRun.executionState,
    canResume: true,
  });
  await syncConversationAgentRun({
    conversationId: nextRun.conversationId,
    userId: auth.userId,
    runId: nextRun._id.toString(),
    agentRun: publicRun,
    content: "审批已通过，任务将继续执行。",
  });
  return Response.json({ success: true, run: publicRun, content: "审批已通过，任务将继续执行。" });
}
