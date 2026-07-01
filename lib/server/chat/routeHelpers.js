import User from "@/models/User";
import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";

export function createChatError(message, status, init = {}) {
  return Response.json(
    { error: message },
    {
      status,
      ...init,
    },
  );
}

export async function requireChatUser(req, rateLimitConfig) {
  const auth = await getAuthPayload();
  if (!auth?.userId) {
    return { response: createChatError("Unauthorized", 401) };
  }

  const clientIP = getClientIP(req);
  const rateLimitKey = `chat:${auth.userId}:${clientIP}`;
  const { success, resetTime } = rateLimit(rateLimitKey, rateLimitConfig);
  if (!success) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return {
      response: createChatError(
        "请求过于频繁，请稍后再试",
        429,
        {
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Remaining": "0",
          },
        },
      ),
    };
  }

  await dbConnect();
  const userDoc = await User.findById(auth.userId).select("_id").lean();
  if (!userDoc) {
    return { response: createChatError("Unauthorized", 401) };
  }

  return {
    auth,
    clientIP,
  };
}

export function buildSseResponseHeaders(conversationId) {
  const headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (conversationId) {
    headers["X-Conversation-Id"] = conversationId;
  }
  return headers;
}
