import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { encryptConversation, encryptSettings } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limits to prevent DoS attacks
const MAX_CONVERSATIONS = 1000;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_MESSAGE_CHARS = 20000;
const MAX_PART_TEXT_CHARS = 10000;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 200;
const MAX_PROMPTS = 50;
const MAX_PROMPT_NAME_CHARS = 80;
const MAX_PROMPT_CONTENT_CHARS = 8000;

const DEFAULT_PROMPT = { name: '默认助手', content: 'You are a helpful AI assistant.' };

const IMPORT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

const ALLOWED_MESSAGE_TYPES = new Set(['text', 'parts', 'error']);
const ALLOWED_ROLES = new Set(['user', 'model']);

const ALLOWED_IMAGE_DOMAINS = [
  'blob.vercel-storage.com',
  'public.blob.vercel-storage.com',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedImageUrl(url) {
  if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_CHARS) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function ensureDefaultFirst(prompts) {
  const list = Array.isArray(prompts) ? [...prompts] : [];
  const idx = list.findIndex((p) => p?.name === '默认助手');
  if (idx === -1) return [DEFAULT_PROMPT, ...list];
  if (idx === 0) return list;
  const [defaultPrompt] = list.splice(idx, 1);
  return [defaultPrompt, ...list];
}

function sanitizeMessage(msg, idx) {
  if (!isPlainObject(msg)) throw new Error(`messages[${idx}] must be an object`);
  const role = msg.role;
  const type = msg.type;
  if (!ALLOWED_ROLES.has(role)) throw new Error(`messages[${idx}].role invalid`);
  if (!ALLOWED_MESSAGE_TYPES.has(type)) throw new Error(`messages[${idx}].type invalid`);

  if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
    throw new Error(`messages[${idx}].parts required`);
  }

  const out = {
    role,
    type,
    content: typeof msg.content === 'string' ? msg.content : '',
  };

  if (out.content.length > MAX_MESSAGE_CHARS) {
    throw new Error(`messages[${idx}].content too long`);
  }

  if (typeof msg.thought === 'string' && msg.thought) out.thought = msg.thought;
  if (Array.isArray(msg.thinkingTimeline) && msg.thinkingTimeline.length > 0) {
    const ALLOWED_KINDS = ['thought', 'search', 'reader'];
    const timeline = [];
    for (const step of msg.thinkingTimeline.slice(0, 50)) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
      const kind = typeof step.kind === 'string' ? step.kind : '';
      if (!ALLOWED_KINDS.includes(kind)) continue;
      const entry = { kind, status: 'done' };
      if (typeof step.id === 'string' && step.id.length <= 128) entry.id = step.id;
      if (typeof step.content === 'string') entry.content = step.content.slice(0, 20000);
      if (typeof step.query === 'string') entry.query = step.query.slice(0, 2048);
      if (typeof step.title === 'string') entry.title = step.title.slice(0, 2048);
      if (typeof step.url === 'string') entry.url = step.url.slice(0, 2048);
      if (typeof step.message === 'string') entry.message = step.message.slice(0, 2048);
      if (Number.isFinite(step.resultCount)) entry.resultCount = step.resultCount;
      if (step.synthetic === true) entry.synthetic = true;
      timeline.push(entry);
    }
    if (timeline.length > 0) out.thinkingTimeline = timeline;
  }
  if (msg.parts.length > MAX_PARTS_PER_MESSAGE) {
    throw new Error(`messages[${idx}].parts too many`);
  }
  const parts = [];
  for (const part of msg.parts) {
    if (!isPlainObject(part)) continue;
    const p = {};
    if (typeof part.text === 'string') {
      if (part.text.length > MAX_PART_TEXT_CHARS) {
        throw new Error(`messages[${idx}].parts text too long`);
      }
      if (part.text) p.text = part.text;
    }
    if (isPlainObject(part.inlineData)) {
      const url = part.inlineData.url;
      if (!isAllowedImageUrl(url)) {
        throw new Error(`messages[${idx}].parts image invalid`);
      }
      const mimeType = typeof part.inlineData.mimeType === 'string' ? part.inlineData.mimeType.trim() : '';
      if (!mimeType || mimeType.length > 128) {
        throw new Error(`messages[${idx}].parts image mimeType invalid`);
      }
      p.inlineData = { url, mimeType };
    }
    if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length <= 256) {
      p.thoughtSignature = part.thoughtSignature;
    }
    if (Object.keys(p).length > 0) parts.push(p);
  }
  if (parts.length === 0) {
    throw new Error(`messages[${idx}].parts invalid`);
  }
  out.parts = parts;

  if (msg.createdAt) {
    const d = new Date(msg.createdAt);
    if (!Number.isNaN(d.getTime())) out.createdAt = d;
  }

  return out;
}

function sanitizeConversation(conv, idx, userId) {
  if (!isPlainObject(conv)) throw new Error(`conversations[${idx}] must be an object`);

  const title = typeof conv.title === 'string' ? conv.title : 'New Chat';
  if (title.length > MAX_TITLE_CHARS) {
    throw new Error(`conversations[${idx}].title too long`);
  }
  const messagesSrc = Array.isArray(conv.messages) ? conv.messages : [];
  const pinned = typeof conv.pinned === 'boolean' ? conv.pinned : false;

  if (messagesSrc.length > MAX_MESSAGES_PER_CONVERSATION) {
    throw new Error(`conversations[${idx}] has too many messages (max ${MAX_MESSAGES_PER_CONVERSATION})`);
  }

  const messages = messagesSrc.map((m, mi) => sanitizeMessage(m, mi));

  const out = {
    userId,
    title,
    messages,
    pinned,
  };

  if (conv.updatedAt) {
    const d = new Date(conv.updatedAt);
    if (!Number.isNaN(d.getTime())) out.updatedAt = d;
  }

  return out;
}

function sanitizeSettings(settingsSrc, userId) {
  if (!settingsSrc || !isPlainObject(settingsSrc)) return null;
  const { _id, userId: _ignoreUserId, __v, ...rest } = settingsSrc;
  const avatar = typeof rest.avatar === 'string' ? rest.avatar : null;
  if (avatar && !isAllowedImageUrl(avatar)) {
    throw new Error('settings.avatar invalid');
  }
  const systemPrompts = Array.isArray(rest.systemPrompts) ? rest.systemPrompts : [];
  if (systemPrompts.length > MAX_PROMPTS) {
    throw new Error(`settings.systemPrompts too many (max ${MAX_PROMPTS})`);
  }
  const sanitizedPrompts = systemPrompts
    .map((p) => {
      if (!isPlainObject(p)) return null;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const content = typeof p.content === 'string' ? p.content.trim() : '';
      if (!name || !content) return null;
      if (name.length > MAX_PROMPT_NAME_CHARS || content.length > MAX_PROMPT_CONTENT_CHARS) {
        throw new Error('settings.systemPrompts item too long');
      }
      return { name, content };
    })
    .filter(Boolean);

  return {
    userId,
    avatar: avatar,
    systemPrompts: ensureDefaultFirst(sanitizedPrompts),
    updatedAt: new Date(),
  };
}

export async function POST(req) {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > 2_000_000) {
    return Response.json({ error: 'Request too large' }, { status: 413 });
  }

  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const clientIP = getClientIP(req);
  const rateLimitKey = `import:${user.userId}:${clientIP}`;
  const { success, resetTime } = rateLimit(rateLimitKey, IMPORT_RATE_LIMIT);
  if (!success) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return Response.json(
      { error: '导入过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (!isPlainObject(payload)) throw new Error('Body must be a JSON object');

    if (payload.schemaVersion !== 1) {
      throw new Error('schemaVersion must be 1');
    }

    if (!isPlainObject(payload.data)) throw new Error('Missing data');

    const conversationsSrc = payload.data.conversations;
    if (!Array.isArray(conversationsSrc)) throw new Error('data.conversations must be an array');

    if (conversationsSrc.length > MAX_CONVERSATIONS) {
      throw new Error(`Too many conversations (max ${MAX_CONVERSATIONS})`);
    }

    const settingsSrc = payload.data.settings;

    const userId = user.userId;
    const conversations = conversationsSrc.map((c, ci) => sanitizeConversation(c, ci, userId));
    const encryptedConversations = conversations.map((c) => encryptConversation(c));

    // 全量覆盖：先清空再重建
    await Conversation.deleteMany({ userId });
    await UserSettings.deleteOne({ userId });

    if (encryptedConversations.length > 0) {
      await Conversation.insertMany(encryptedConversations, { ordered: true });
    }

    if (settingsSrc) {
      const sanitizedSettings = sanitizeSettings(settingsSrc, userId);
      if (sanitizedSettings) {
        await UserSettings.create(encryptSettings(sanitizedSettings));
      }
    }

    return Response.json({
      success: true,
      imported: {
        conversationsCount: encryptedConversations.length,
        settings: Boolean(settingsSrc),
      },
    });
  } catch (e) {
    return Response.json({ error: e?.message }, { status: 400 });
  }
}
