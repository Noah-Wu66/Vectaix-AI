import dbConnect from '@/lib/db';
import { getUserAccessFlags, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';

export const dynamic = 'force-dynamic';

const ENCRYPTION_PREFIX = 'enc:v1:';

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(req) {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: '无权限' }, { status: 403 });
  }

  await dbConnect();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = 20;
  const skip = (page - 1) * limit;

  const safeSearch = search.slice(0, 100);
  const filter = safeSearch
    ? { email: { $regex: escapeRegex(safeSearch), $options: 'i' } }
    : {};

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('email createdAt')
      .lean(),
    User.countDocuments(filter),
  ]);

  // 批量查询每个用户的对话数
  const userIds = users.map(u => u._id);
  const convCounts = await Conversation.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of convCounts) {
    countMap[c._id.toString()] = c.count;
  }

  const result = users.map(u => ({
    ...getUserAccessFlags(u),
    id: u._id.toString(),
    email: u.email,
    createdAt: u.createdAt,
    conversationCount: countMap[u._id.toString()] || 0,
  }));

  return Response.json({
    users: result,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

// 清除全部用户的加密数据（包含侧边栏会话标题）
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: '无权限' }, { status: 403 });
  }

  await dbConnect();

  const encRegex = new RegExp('^' + escapeRegex(ENCRYPTION_PREFIX));

  // 用 MongoDB $regex 直接在数据库层面筛选，避免全量加载到内存
  const convFilter = {
    $or: [
      { title: { $regex: encRegex } },
      { 'messages.content': { $regex: encRegex } },
      { 'messages.parts.text': { $regex: encRegex } },
      { 'messages.thought': { $regex: encRegex } },
    ],
  };

  const settingsFilter = {
    $or: [
      { 'systemPrompts.name': { $regex: encRegex } },
      { 'systemPrompts.content': { $regex: encRegex } },
    ],
  };

  // 先查受影响的用户 ID（只取 userId，不加载内容）
  const [affectedConvs, affectedSettings] = await Promise.all([
    Conversation.find(convFilter).select('userId').lean(),
    UserSettings.find(settingsFilter).select('userId').lean(),
  ]);

  const encryptedUserIds = new Set();
  for (const c of affectedConvs) {
    if (c.userId) encryptedUserIds.add(c.userId.toString());
  }
  for (const s of affectedSettings) {
    if (s.userId) encryptedUserIds.add(s.userId.toString());
  }

  // 批量删除
  const [convResult, settingsResult] = await Promise.all([
    affectedConvs.length > 0 ? Conversation.deleteMany(convFilter) : { deletedCount: 0 },
    affectedSettings.length > 0 ? UserSettings.deleteMany(settingsFilter) : { deletedCount: 0 },
  ]);

  return Response.json({
    success: true,
    deletedConversations: convResult.deletedCount || 0,
    deletedSettings: settingsResult.deletedCount || 0,
    affectedUsers: encryptedUserIds.size,
  });
}
