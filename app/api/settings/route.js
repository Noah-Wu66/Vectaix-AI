import dbConnect from '@/lib/db';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

async function parseJsonBody(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

// 获取用户设置（只返回系统提示词）
export async function GET() {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await UserSettings.findOne({ userId: user.userId });
  if (!settings) {
    return Response.json({
      settings: {
        systemPrompts: [],
        avatar: null,
      },
    });
  }

  return Response.json({ settings: settings.toObject() });
}

// 添加系统提示词
export async function POST(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: '请求体格式错误' }, { status: 400 });
  const { name, content } = parsed.body || {};

  if (!name || !content) {
    return Response.json({ error: 'Name and content are required' }, { status: 400 });
  }

  // 输入验证：限制长度
  const MAX_PROMPT_NAME_LENGTH = 50;
  const MAX_PROMPT_CONTENT_LENGTH = 10000;

  if (typeof name !== 'string' || name.length > MAX_PROMPT_NAME_LENGTH) {
    return Response.json({ error: `Name must be a string and cannot exceed ${MAX_PROMPT_NAME_LENGTH} characters` }, { status: 400 });
  }

  if (typeof content !== 'string' || content.length > MAX_PROMPT_CONTENT_LENGTH) {
    return Response.json({ error: `Content must be a string and cannot exceed ${MAX_PROMPT_CONTENT_LENGTH} characters` }, { status: 400 });
  }

  let settings = await UserSettings.findOne({ userId: user.userId });

  if (!settings) {
    settings = await UserSettings.create({
      userId: user.userId,
      systemPrompts: [{ name, content }]
    });
  } else {
    const nextPrompts = Array.isArray(settings.systemPrompts)
      ? [...settings.systemPrompts, { name, content }]
      : [{ name, content }];
    settings.systemPrompts = nextPrompts;
    settings.updatedAt = Date.now();
    await settings.save();
  }

  return Response.json({ settings: settings.toObject() });
}

// 删除系统提示词
export async function DELETE(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: '请求体格式错误' }, { status: 400 });
  const { promptId } = parsed.body || {};

  const settings = await UserSettings.findOne({ userId: user.userId });
  if (!settings) return Response.json({ error: 'Settings not found' }, { status: 404 });

  const targetPrompt = settings.systemPrompts.find(p => p._id.toString() === promptId);
  if (!targetPrompt) return Response.json({ error: 'Prompt not found' }, { status: 404 });

  settings.systemPrompts = settings.systemPrompts.filter(p => p._id.toString() !== promptId);
  settings.updatedAt = Date.now();
  await settings.save();

  return Response.json({ settings: settings.toObject() });
}

// 更新用户头像
export async function PUT(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: '请求体格式错误' }, { status: 400 });
  const { avatar } = parsed.body || {};

  if (avatar !== null && avatar !== undefined && typeof avatar !== 'string') {
    return Response.json({ error: 'avatar must be a string or null' }, { status: 400 });
  }

  let settings = await UserSettings.findOne({ userId: user.userId });

  if (!settings) {
    settings = await UserSettings.create({
      userId: user.userId,
      avatar,
      systemPrompts: []
    });
  } else {
    settings.avatar = avatar;
    settings.updatedAt = Date.now();
    await settings.save();
  }

  return Response.json({ settings: settings.toObject() });
}

// 编辑系统提示词
export async function PATCH(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: '请求体格式错误' }, { status: 400 });
  const { promptId, name, content } = parsed.body || {};

  if (!promptId || !name || !content) {
    return Response.json({ error: 'promptId, name and content are required' }, { status: 400 });
  }

  // 输入验证：限制长度
  const MAX_PROMPT_NAME_LENGTH = 50;
  const MAX_PROMPT_CONTENT_LENGTH = 10000;

  if (typeof name !== 'string' || name.length > MAX_PROMPT_NAME_LENGTH) {
    return Response.json({ error: `Name must be a string and cannot exceed ${MAX_PROMPT_NAME_LENGTH} characters` }, { status: 400 });
  }

  if (typeof content !== 'string' || content.length > MAX_PROMPT_CONTENT_LENGTH) {
    return Response.json({ error: `Content must be a string and cannot exceed ${MAX_PROMPT_CONTENT_LENGTH} characters` }, { status: 400 });
  }

  const settings = await UserSettings.findOne({ userId: user.userId });
  if (!settings) return Response.json({ error: 'Settings not found' }, { status: 404 });

  const p = settings.systemPrompts?.id?.(promptId);
  if (!p) return Response.json({ error: 'Prompt not found' }, { status: 404 });

  p.name = String(name);
  p.content = String(content);
  settings.updatedAt = Date.now();
  await settings.save();

  return Response.json({ settings: settings.toObject() });
}
