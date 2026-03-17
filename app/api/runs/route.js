import { after } from "next/server";
import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { AGENT_MODEL_ID } from "@/lib/shared/models";
import { createRunRequest, getActiveRunSummaries } from "@/lib/server/runs/service";
import { executeAgentRunInBackground, executeChatRunById } from "@/lib/server/runs/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2_000_000;

function extractRequestHeaders(request) {
  return {
    host: request.headers.get("host") || "",
    "x-forwarded-host": request.headers.get("x-forwarded-host") || "",
    "x-forwarded-proto": request.headers.get("x-forwarded-proto") || "",
    cookie: request.headers.get("cookie") || "",
  };
}

export async function GET() {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runs = await getActiveRunSummaries(auth.userId);
  return Response.json({ runs });
}

export async function POST(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const {
    prompt,
    model,
    config,
    history,
    historyLimit,
    conversationId,
    settings,
    userMessageId,
    messageId,
    mode,
    messages,
  } = body || {};

  if (typeof model !== "string" || !model) {
    return Response.json({ error: "Model is required" }, { status: 400 });
  }

  try {
    const requestHeaders = extractRequestHeaders(request);
    const created = await createRunRequest({
      userId: auth.userId,
      model,
      prompt,
      config,
      history,
      historyLimit,
      conversationId,
      settings,
      userMessageId,
      messageId,
      mode,
      messages,
    });

    if (model === AGENT_MODEL_ID) {
      after(async () => {
        try {
          await executeAgentRunInBackground({
            conversationId: created.conversationId,
            userId: auth.userId,
            messageId: created.messageId,
            prompt,
            history,
            historyLimit,
            config,
            requestHeaders,
          });
        } catch (error) {
          console.error("Agent background run failed:", error?.message || error);
        }
      });
    } else if (created.runId) {
      after(async () => {
        try {
          await executeChatRunById(created.runId, requestHeaders);
        } catch (error) {
          console.error("Chat background run failed:", error?.message || error);
        }
      });
    }

    return Response.json({
      success: true,
      runId: created.runId || "",
      runType: created.runType,
      conversationId: created.conversationId,
      userMessageId: created.userMessageId,
      messageId: created.messageId,
      provider: created.provider,
    });
  } catch (error) {
    return Response.json({ error: error?.message || "创建任务失败" }, { status: 400 });
  }
}
