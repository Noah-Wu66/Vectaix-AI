import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import {
  AGENT_EXECUTION_STATES,
  buildAgentMessageMeta,
  generateResumeToken,
} from "@/lib/server/agent/runHelpers";
import { patchConversationMessage } from "@/lib/server/runs/service";
import { publishRunStatus } from "@/lib/server/realtime/publishers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const conversation = await Conversation.findOne({ _id: nextRun.conversationId, userId: auth.userId }).select("messages");
  const targetMessage = Array.isArray(conversation?.messages)
    ? conversation.messages.find((item) => item?.agentRun?.runId === nextRun._id.toString() || item?.id === nextRun._id.toString())
    : null;
  if (targetMessage?.id) {
    await patchConversationMessage({
      conversationId: nextRun.conversationId,
      userId: auth.userId,
      messageId: targetMessage.id,
      patch: {
        content: "审批已通过，任务将继续执行。",
        parts: [{ text: "审批已通过，任务将继续执行。" }],
        agentRun: publicRun,
      },
    });
    await publishRunStatus({
      conversationId: nextRun.conversationId,
      runId: nextRun._id,
      runType: "agent",
      messageId: targetMessage.id,
      status: publicRun.status,
      phase: publicRun.executionState,
      updatedAt: publicRun.updatedAt,
    });
  }
  return Response.json({ success: true, run: publicRun, content: "审批已通过，任务将继续执行。" });
}
