import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import {
  deleteConversationForUser,
  getConversationForUser,
  isValidConversationId,
  updateConversationForUser,
} from "@/lib/server/conversations/service";
import {
  publishConversationRemove,
  publishConversationUpsert,
  publishMessageRemove,
  publishMessageUpsert,
} from "@/lib/server/realtime/publishers";

const MAX_REQUEST_BYTES = 2_000_000;

async function requireConversationUser() {
  await dbConnect();
  return getAuthPayload();
}

async function getRouteId(context) {
  const { id } = await context.params;
  return id;
}

export async function GET(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const conversation = await getConversationForUser(id, user.userId);
  if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ conversation });
}

export async function DELETE(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const conversation = await getConversationForUser(id, user.userId);
  if (!conversation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await deleteConversationForUser(id, user.userId);
  await publishConversationRemove({ conversationId: id, userId: user.userId });
  return Response.json({ success: true });
}

export async function PUT(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
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
    const previousConversation = await getConversationForUser(id, user.userId);
    if (!previousConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const conversation = await updateConversationForUser(id, user.userId, body);
    const nextConversation = conversation?.toObject?.() || conversation;

    await publishConversationUpsert({
      conversationId: id,
      userId: user.userId,
      conversation: nextConversation,
    });

    if (Array.isArray(body?.messages)) {
      const previousIds = new Set(
        (Array.isArray(previousConversation?.messages) ? previousConversation.messages : [])
          .map((message) => (typeof message?.id === "string" ? message.id : ""))
          .filter(Boolean),
      );
      const nextIds = new Set(
        (Array.isArray(nextConversation?.messages) ? nextConversation.messages : [])
          .map((message) => (typeof message?.id === "string" ? message.id : ""))
          .filter(Boolean),
      );

      const removedMessageIds = [...previousIds].filter((messageId) => !nextIds.has(messageId));
      await Promise.all([
        ...removedMessageIds.map((messageId) => publishMessageRemove({ conversationId: id, messageId })),
        ...(Array.isArray(nextConversation?.messages) ? nextConversation.messages : []).map((message) => (
          publishMessageUpsert({
            conversationId: id,
            userId: user.userId,
            message,
          })
        )),
      ]);
    }

    return Response.json({ conversation: nextConversation });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}
