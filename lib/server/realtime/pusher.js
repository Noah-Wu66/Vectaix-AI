import Pusher from "pusher";
import { getConversationChannelName, getUserChannelName } from "@/lib/shared/realtime";

let pusherServer = null;

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error(`缺少环境变量：${name}`);
}

function getPusherServer() {
  if (pusherServer) return pusherServer;
  pusherServer = new Pusher({
    appId: readRequiredEnv("PUSHER_APP_ID"),
    key: readRequiredEnv("PUSHER_KEY"),
    secret: readRequiredEnv("PUSHER_SECRET"),
    cluster: readRequiredEnv("PUSHER_CLUSTER"),
    useTLS: true,
  });
  return pusherServer;
}

export async function triggerUserEvent(userId, eventName, payload) {
  if (!userId || !eventName) return;
  await getPusherServer().trigger(getUserChannelName(userId), eventName, payload);
}

export async function triggerConversationEvent(conversationId, eventName, payload) {
  if (!conversationId || !eventName) return;
  await getPusherServer().trigger(getConversationChannelName(conversationId), eventName, payload);
}

export function authorizePrivateChannel(socketId, channelName) {
  return getPusherServer().authorizeChannel(socketId, channelName);
}
