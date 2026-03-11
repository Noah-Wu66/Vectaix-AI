import mongoose from "mongoose";
import Conversation from "@/models/Conversation";
import UserSettings from "@/models/UserSettings";
import {
  sanitizeImportedConversation,
  sanitizeImportedUserSettings,
} from "@/lib/server/conversations/sanitize";

export function buildExportFilename(date = new Date()) {
  const pad2 = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `vectaix-export-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
}

export async function buildUserExportPayload(userId) {
  const conversations = await Conversation.find({ userId })
    .sort({ updatedAt: 1 })
    .lean();
  const settings = await UserSettings.findOne({ userId }).lean();

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      conversations,
      settings,
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseImportPayload(payload, userId) {
  if (!isPlainObject(payload)) throw new Error("Body must be a JSON object");
  if (payload.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!isPlainObject(payload.data)) throw new Error("Missing data");
  if (!Array.isArray(payload.data.conversations)) {
    throw new Error("data.conversations must be an array");
  }
  if (payload.data.conversations.length > 1000) {
    throw new Error("Too many conversations (max 1000)");
  }

  return {
    conversations: payload.data.conversations.map((conversation, index) =>
      sanitizeImportedConversation(conversation, index, userId)
    ),
    settings: sanitizeImportedUserSettings(payload.data.settings, userId),
  };
}

export async function importUserData(userId, payload) {
  const { conversations, settings } = parseImportPayload(payload, userId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Conversation.deleteMany({ userId }, { session });
      await UserSettings.deleteOne({ userId }, { session });

      if (conversations.length > 0) {
        await Conversation.insertMany(conversations, { ordered: true, session });
      }

      if (settings) {
        await UserSettings.create([settings], { session });
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    conversationsCount: conversations.length,
    settings: Boolean(settings),
  };
}
