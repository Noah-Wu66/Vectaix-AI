"use client";

import Pusher from "pusher-js";

let pusherClient = null;
const NEXT_PUBLIC_PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const NEXT_PUBLIC_PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

function readRequiredEnv(name, value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error(`缺少环境变量：${name}`);
}

export function getPusherClient() {
  if (pusherClient) return pusherClient;
  pusherClient = new Pusher(readRequiredEnv("NEXT_PUBLIC_PUSHER_KEY", NEXT_PUBLIC_PUSHER_KEY), {
    cluster: readRequiredEnv("NEXT_PUBLIC_PUSHER_CLUSTER", NEXT_PUBLIC_PUSHER_CLUSTER),
    forceTLS: true,
    authEndpoint: "/api/realtime/auth",
  });
  return pusherClient;
}

export function disconnectPusherClient() {
  if (!pusherClient) return;
  pusherClient.disconnect();
  pusherClient = null;
}
