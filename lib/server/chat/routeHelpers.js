import Conversation from "@/models/Conversation";
import User from "@/models/User";
import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { parseWebSearchConfig } from "@/lib/server/chat/requestConfig";
import { loadConversationForRoute } from "@/app/api/chat/conversationState";

export function createChatError(message, status, init = {}) {
  return Response.json(
    { error: message },
    {
      status,
      ...init,
    },
  );
}

export function validateChatRequestBody(body, { requirePrompt = true } = {}) {
  const prompt = body?.prompt;
  const model = body?.model;
  const history = body?.history;

  if (!model || typeof model !== "string") {
    return createChatError("Model is required", 400);
  }
  if (requirePrompt && typeof prompt !== "string") {
    return createChatError("Prompt is required", 400);
  }
  if (!Array.isArray(history)) {
    return createChatError("history must be an array", 400);
  }
  return null;
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

export function buildConversationTitle(prompt, fallback = "New Chat") {
  const source = typeof prompt === "string" && prompt.trim()
    ? prompt.trim()
    : fallback;
  return source.length > 30 ? `${source.slice(0, 30)}...` : source;
}

export async function ensureConversationForChatRequest({
  userId,
  conversationId,
  expectedProvider,
  prompt,
  fallbackTitle = "New Chat",
  model,
  settings,
  webSearch,
}) {
  let currentConversationId = conversationId;
  let currentConversation = await loadConversationForRoute({
    conversationId: currentConversationId,
    userId,
    expectedProvider,
  });
  let createdConversationForRequest = false;

  if (!currentConversationId) {
    const createdConversation = await Conversation.create({
      userId,
      title: buildConversationTitle(prompt, fallbackTitle),
      model,
      settings: {
        ...(settings && typeof settings === "object" ? settings : {}),
        webSearch: parseWebSearchConfig(webSearch),
      },
      messages: [],
    });
    currentConversationId = createdConversation._id.toString();
    currentConversation = createdConversation.toObject();
    createdConversationForRequest = true;
  }

  return {
    currentConversationId,
    currentConversation,
    createdConversationForRequest,
    previousMessages: Array.isArray(currentConversation?.messages) ? currentConversation.messages : [],
    previousUpdatedAt: currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date(),
  };
}

export async function persistRegenerateConversationMessages({
  conversationId,
  userId,
  messages,
}) {
  const regenerateTime = Date.now();
  const conversation = await Conversation.findOneAndUpdate(
    { _id: conversationId, userId },
    { $set: { messages, updatedAt: regenerateTime } },
    { new: true },
  ).select("messages updatedAt");
  if (!conversation) {
    return null;
  }
  return {
    conversation,
    writePermitTime: conversation.updatedAt?.getTime?.(),
  };
}

export async function persistUserConversationMessage({
  conversationId,
  userId,
  userMessage,
}) {
  const userMsgTime = Date.now();
  const conversation = await Conversation.findOneAndUpdate(
    { _id: conversationId, userId },
    {
      $push: { messages: userMessage },
      updatedAt: userMsgTime,
    },
    { new: true },
  ).select("updatedAt");
  if (!conversation) {
    return null;
  }
  return {
    conversation,
    writePermitTime: conversation.updatedAt?.getTime?.() ?? userMsgTime,
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
