import { after } from "next/server";
import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import Conversation from "@/models/Conversation";
import { handoffAgentRunToBackground } from "@/lib/server/runs/execute";

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
  const run = await AgentRun.findOne({ _id: id, userId: auth.userId })
    .select("_id conversationId metadata status")
    .lean()
    .catch(() => null);
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (run.status !== "running") {
    return Response.json({ success: true, skipped: true });
  }

  let messageId = typeof run?.metadata?.messageId === "string" ? run.metadata.messageId : "";
  if (!messageId) {
    const conversation = await Conversation.findOne({ _id: run.conversationId, userId: auth.userId })
      .select("messages")
      .lean()
      .catch(() => null);
    const targetMessage = Array.isArray(conversation?.messages)
      ? conversation.messages.find((item) => item?.agentRun?.runId === String(run._id))
      : null;
    messageId = typeof targetMessage?.id === "string" ? targetMessage.id : "";
  }

  if (!messageId) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  const requestHeaders = extractRequestHeaders(request);
  after(async () => {
    await handoffAgentRunToBackground({
      runId: String(run._id),
      conversationId: String(run.conversationId),
      userId: auth.userId,
      messageId,
      requestHeaders,
    });
  });

  return Response.json({ success: true });
}
