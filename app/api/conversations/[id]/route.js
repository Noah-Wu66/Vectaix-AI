import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import {
  deleteConversationForUser,
  getConversationForUser,
  isValidConversationId,
  updateConversationForUser,
} from "@/lib/server/conversations/service";

const MAX_REQUEST_BYTES = 2_000_000;

async function requireConversationUser() {
  await dbConnect();
  return getAuthPayload();
}

export async function GET(req, { params }) {
  if (!isValidConversationId(params.id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const conversation = await getConversationForUser(params.id, user.userId);
  if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ conversation });
}

export async function DELETE(req, { params }) {
  if (!isValidConversationId(params.id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await deleteConversationForUser(params.id, user.userId);
  return Response.json({ success: true });
}

export async function PUT(req, { params }) {
  if (!isValidConversationId(params.id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  const user = await requireConversationUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const conversation = await updateConversationForUser(params.id, user.userId, body);
    return Response.json({ conversation: conversation?.toObject?.() || conversation });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}
