import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import {
  AGENT_EXECUTION_STATES,
  buildAgentMessageMeta,
  generateResumeToken,
} from "@/lib/server/agent/runHelpers";
import { killSandboxSession } from "@/lib/server/sandbox/vercelSandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateRunAction(run, action) {
  const status = typeof run?.status === "string" ? run.status : "";
  const executionState = typeof run?.executionState === "string" ? run.executionState : "";
  const approvalStatus = typeof run?.approvalRequest?.status === "string" ? run.approvalRequest.status : "";

  if (action === "approve" || action === "reject") {
    const canHandleApproval =
      executionState === AGENT_EXECUTION_STATES.awaitingApproval &&
      approvalStatus === "pending";
    if (!canHandleApproval) {
      return "当前任务不在等待审批状态，不能执行这个操作。";
    }
    return "";
  }

  if (action === "cancel") {
    if (status === "completed" || status === "cancelled") {
      return "当前任务已经结束，不能再取消。";
    }
  }

  return "";
}

async function syncConversationAgentRun({ conversationId, userId, runId, agentRun, content }) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId }).select("messages");
  if (!conversation) return;
  const nextMessages = Array.isArray(conversation.messages)
    ? conversation.messages.map((item) => (item?.toObject ? item.toObject() : item))
    : [];
  const index = nextMessages.findIndex((item) => item?.agentRun?.runId === runId);
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

export async function POST(req, { params }) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = typeof body?.action === "string" ? body.action.trim() : "";
  if (!["approve", "reject", "cancel"].includes(action)) {
    return Response.json({ error: "action invalid" }, { status: 400 });
  }

  const run = await AgentRun.findOne({ _id: params.id, userId: auth.userId });
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const actionError = validateRunAction(run, action);
  if (actionError) {
    return Response.json({ error: actionError }, { status: 409 });
  }

  const patch = { updatedAt: new Date() };
  let content = run.finalAnswer || run.approvalRequest?.reason || "任务状态已更新。";

  if (action === "approve") {
    patch.status = "waiting_continue";
    patch.executionState = AGENT_EXECUTION_STATES.waitingContinue;
    patch.resumeToken = generateResumeToken();
    patch.approvalRequest = {
      ...(run.approvalRequest || {}),
      status: "approved",
      decidedAt: new Date(),
    };
    content = "审批已通过，任务将继续执行。";
  } else if (action === "reject") {
    patch.status = "cancelled";
    patch.executionState = AGENT_EXECUTION_STATES.cancelled;
    patch.failureReason = "用户拒绝继续执行";
    patch.approvalRequest = {
      ...(run.approvalRequest || {}),
      status: "rejected",
      decidedAt: new Date(),
    };
    patch.sandboxSession = null;
    content = "你已拒绝继续执行，本次任务已结束。";
    await killSandboxSession(run.sandboxSession).catch(() => {});
  } else if (action === "cancel") {
    patch.status = "cancelled";
    patch.executionState = AGENT_EXECUTION_STATES.cancelled;
    patch.failureReason = "用户取消任务";
    patch.sandboxSession = null;
    content = "任务已取消。";
    await killSandboxSession(run.sandboxSession).catch(() => {});
  }

  const nextRun = await AgentRun.findByIdAndUpdate(run._id, { $set: patch }, { new: true });
  const publicRun = buildAgentMessageMeta(nextRun, {
    status: nextRun.status,
    executionState: nextRun.executionState,
    canResume: nextRun.status === "waiting_continue",
  });
  await syncConversationAgentRun({
    conversationId: nextRun.conversationId,
    userId: auth.userId,
    runId: nextRun._id.toString(),
    agentRun: publicRun,
    content,
  });

  return Response.json({ success: true, run: publicRun, content });
}
