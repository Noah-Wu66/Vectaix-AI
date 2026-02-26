import dbConnect from '@/lib/db';
import { requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';

export const dynamic = 'force-dynamic';

const ENCRYPTION_PREFIX = 'enc:v1:';

function hasEncryptedData(obj) {
    if (typeof obj === 'string') {
        return obj.startsWith(ENCRYPTION_PREFIX);
    }
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) {
        return obj.some(item => hasEncryptedData(item));
    }
    return Object.values(obj).some(val => hasEncryptedData(val));
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

    const filter = search ? { email: { $regex: search, $options: 'i' } } : {};

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

    const encryptedConversationIds = [];
    const encryptedUserIds = new Set();

    const conversations = await Conversation.find({})
        .select('_id userId title messages settings')
        .lean();

    for (const conv of conversations) {
        const shouldDelete = hasEncryptedData({
            title: conv.title,
            messages: conv.messages,
            settings: conv.settings,
        });

        if (shouldDelete) {
            encryptedConversationIds.push(conv._id);
            if (conv.userId) {
                encryptedUserIds.add(conv.userId.toString());
            }
        }
    }

    let deletedConversations = 0;
    if (encryptedConversationIds.length > 0) {
        const result = await Conversation.deleteMany({ _id: { $in: encryptedConversationIds } });
        deletedConversations = result.deletedCount || 0;
    }

    const encryptedSettingIds = [];
    const settings = await UserSettings.find({})
        .select('_id userId systemPrompts')
        .lean();

    for (const setting of settings) {
        if (hasEncryptedData(setting.systemPrompts)) {
            encryptedSettingIds.push(setting._id);
            if (setting.userId) {
                encryptedUserIds.add(setting.userId.toString());
            }
        }
    }

    let deletedSettings = 0;
    if (encryptedSettingIds.length > 0) {
        const result = await UserSettings.deleteMany({ _id: { $in: encryptedSettingIds } });
        deletedSettings = result.deletedCount || 0;
    }

    return Response.json({
        success: true,
        deletedConversations,
        deletedSettings,
        affectedUsers: encryptedUserIds.size,
    });
}
