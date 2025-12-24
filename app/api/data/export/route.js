import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET() {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const conversations = await Conversation.find({ userId: user.userId })
    .sort({ updatedAt: 1 })
    .lean();

  const settings = await UserSettings.findOne({ userId: user.userId }).lean();

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      conversations,
      settings: settings || null,
    },
  };

  const body = JSON.stringify(payload);
  const filename = buildFilename();

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}


