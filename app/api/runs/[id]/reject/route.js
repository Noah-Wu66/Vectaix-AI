import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import { AGENT_EXECUTION_STATES, buildAgentMessageMeta } from "@/lib/server/agent/runHelpers";
import { killSandboxSession } from "@/lib/server/sandbox/vercelSandbox";

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
    content,
    parts: [{ text: content }],
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

  await killSandboxSession(run.sandboxSession).catch(() => {});
  const nextRun = await AgentRun.findByIdAndUpdate(
    run._id,
    {
      $set: {
        status: "cancelled",
        executionState: AGENT_EXECUTION_STATES.cancelled,
        failureReason: "用户拒绝继续执行",
        approvalRequest: {
          ...(run.approvalRequest || {}),
          status: "rejected",
          decidedAt: new Date(),
        },
        sandboxSession: null,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
  const publicRun = buildAgentMessageMeta(nextRun, {
    status: nextRun.status,
    executionState: nextRun.executionState,
    canResume: false,
  });
  await syncConversationAgentRun({
    conversationId: nextRun.conversationId,
    userId: auth.userId,
    runId: nextRun._id.toString(),
    agentRun: publicRun,
    content: "你已拒绝继续执行，本次任务已结束。",
  });
  return Response.json({ success: true, run: publicRun, content: "你已拒绝继续执行，本次任务已结束。" });
}
