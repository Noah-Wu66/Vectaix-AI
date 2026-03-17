import { after } from "next/server";
import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import { buildAgentMessageMeta } from "@/lib/server/agent/runHelpers";
import { patchConversationMessage } from "@/lib/server/runs/service";
import { resumeAgentRunInBackground } from "@/lib/server/runs/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractRequestHeaders(request) {
  return {
    host: request.headers.get("host") || "",
    "x-forwarded-host": request.headers.get("x-forwarded-host") || "",
    "x-forwarded-proto": request.headers.get("x-forwarded-proto") || "",
    cookie: request.headers.get("cookie") || "",
  };
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
  if (run.status !== "waiting_continue") {
    return Response.json({ error: "当前任务不能继续执行。" }, { status: 409 });
  }

  const conversation = await Conversation.findOne({ _id: run.conversationId, userId: auth.userId }).select("messages");
  if (!conversation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map((item) => (item?.toObject ? item.toObject() : item))
    : [];
  const targetMessage = messages.find((item) => item?.agentRun?.runId === run._id.toString());
  if (!targetMessage?.id) {
    return Response.json({ error: "未找到对应的任务消息" }, { status: 404 });
  }

  const publicRun = buildAgentMessageMeta(run, {
    status: "running",
    executionState: "running",
    canResume: false,
  });
  await patchConversationMessage({
    conversationId: run.conversationId,
    userId: auth.userId,
    messageId: targetMessage.id,
    patch: {
      content: "继续执行中...",
      parts: [{ text: "继续执行中..." }],
      agentRun: publicRun,
    },
  });

  const requestHeaders = extractRequestHeaders(request);
  after(async () => {
    try {
      await resumeAgentRunInBackground({
        runId: run._id.toString(),
        conversationId: run.conversationId.toString(),
        userId: auth.userId,
        messageId: targetMessage.id,
        requestHeaders,
      });
    } catch (error) {
      console.error("Resume agent run failed:", error?.message || error);
    }
  });

  return Response.json({ success: true, run: publicRun });
}
