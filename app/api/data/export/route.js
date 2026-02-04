import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { decryptConversation, decryptSettings } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPORT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildFilename() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `vectaix-export-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
}

export async function GET(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const clientIP = getClientIP(req);
  const rateLimitKey = `export:${user.userId}:${clientIP}`;
  const { success, resetTime } = rateLimit(rateLimitKey, EXPORT_RATE_LIMIT);
  if (!success) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return Response.json(
      { error: '导出过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const conversations = await Conversation.find({ userId: user.userId })
    .sort({ updatedAt: 1 })
    .lean();

  const settings = await UserSettings.findOne({ userId: user.userId }).lean();
  const decryptedConversations = conversations.map((conv) => decryptConversation(conv));
  const decryptedSettings = settings ? decryptSettings(settings) : settings;

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      conversations: decryptedConversations,
      settings: decryptedSettings,
    },
  };

  const body = JSON.stringify(payload);
  const filename = buildFilename();

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
