import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import Conversation from "@/models/Conversation";
import { getConversationIdFromChannelName, getUserIdFromChannelName } from "@/lib/shared/realtime";
import { authorizePrivateChannel } from "@/lib/server/realtime/pusher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readAuthBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return {
      socketId: typeof body?.socket_id === "string" ? body.socket_id : "",
      channelName: typeof body?.channel_name === "string" ? body.channel_name : "",
    };
  }
  const formData = await request.formData().catch(() => null);
  return {
    socketId: typeof formData?.get("socket_id") === "string" ? formData.get("socket_id") : "",
    channelName: typeof formData?.get("channel_name") === "string" ? formData.get("channel_name") : "",
  };
}

export async function POST(request) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { socketId, channelName } = await readAuthBody(request);
  if (!socketId || !channelName) {
    return Response.json({ error: "Invalid auth payload" }, { status: 400 });
  }

  const channelUserId = getUserIdFromChannelName(channelName);
  if (channelUserId) {
    if (channelUserId !== String(auth.userId)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(authorizePrivateChannel(socketId, channelName));
  }

  const conversationId = getConversationIdFromChannelName(channelName);
  if (!conversationId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await Conversation.findOne({ _id: conversationId, userId: auth.userId })
    .select("_id")
    .lean()
    .catch(() => null);
  if (!conversation) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json(authorizePrivateChannel(socketId, channelName));
}
