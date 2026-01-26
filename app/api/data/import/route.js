import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limits to prevent DoS attacks
const MAX_CONVERSATIONS = 1000;
const MAX_MESSAGES_PER_CONVERSATION = 500;

const ALLOWED_MESSAGE_TYPES = new Set(['text', 'parts', 'error']);
const ALLOWED_ROLES = new Set(['user', 'model']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeMessage(msg, idx) {
  if (!isPlainObject(msg)) throw new Error(`messages[${idx}] must be an object`);
  const role = msg.role;
  const type = msg.type ?? 'text';
  if (!ALLOWED_ROLES.has(role)) throw new Error(`messages[${idx}].role invalid`);
  if (!ALLOWED_MESSAGE_TYPES.has(type)) throw new Error(`messages[${idx}].type invalid`);

  const out = {
    role,
    type,
    content: typeof msg.content === 'string' ? msg.content : '',
  };

  if (typeof msg.thought === 'string' && msg.thought) out.thought = msg.thought;
  if (typeof msg.image === 'string' && msg.image) out.image = msg.image;
  if (typeof msg.mimeType === 'string' && msg.mimeType) out.mimeType = msg.mimeType;
  if (Array.isArray(msg.parts) && msg.parts.length > 0) out.parts = msg.parts;

  if (msg.createdAt) {
    const d = new Date(msg.createdAt);
    if (!Number.isNaN(d.getTime())) out.createdAt = d;
  }

  return out;
}

function sanitizeConversation(conv, idx, userId) {
  if (!isPlainObject(conv)) throw new Error(`conversations[${idx}] must be an object`);

  const title = typeof conv.title === 'string' ? conv.title : 'New Chat';
  const messagesSrc = Array.isArray(conv.messages) ? conv.messages : [];

  if (messagesSrc.length > MAX_MESSAGES_PER_CONVERSATION) {
    throw new Error(`conversations[${idx}] has too many messages (max ${MAX_MESSAGES_PER_CONVERSATION})`);
  }

  const messages = messagesSrc.map((m, mi) => sanitizeMessage(m, mi));

  const out = {
    userId,
    title,
    messages,
  };

  if (conv.updatedAt) {
    const d = new Date(conv.updatedAt);
    if (!Number.isNaN(d.getTime())) out.updatedAt = d;
  }

  return out;
}

export async function POST(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (!isPlainObject(payload)) throw new Error('Body must be a JSON object');
    if (!isPlainObject(payload.data)) throw new Error('Missing data');

    const conversationsSrc = payload.data.conversations;
    if (!Array.isArray(conversationsSrc)) throw new Error('data.conversations must be an array');

    if (conversationsSrc.length > MAX_CONVERSATIONS) {
      throw new Error(`Too many conversations (max ${MAX_CONVERSATIONS})`);
    }

    const settingsSrc = payload.data.settings ?? null;

    const userId = user.userId;
    const conversations = conversationsSrc.map((c, ci) => sanitizeConversation(c, ci, userId));

    // 全量覆盖：先清空再重建
    await Conversation.deleteMany({ userId });
    await UserSettings.deleteOne({ userId });

    if (conversations.length > 0) {
      await Conversation.insertMany(conversations, { ordered: true });
    }

    if (settingsSrc) {
      const { _id, userId: _ignoreUserId, __v, ...rest } = settingsSrc;
      await UserSettings.create({ userId, ...rest });
    }

    return Response.json({
      success: true,
      imported: {
        conversationsCount: conversations.length,
        settings: Boolean(settingsSrc),
      },
    });
  } catch (e) {
    return Response.json({ error: e?.message || 'Bad Request' }, { status: 400 });
  }
}


