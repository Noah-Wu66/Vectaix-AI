import dbConnect from '@/lib/db';
import { requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import BlobFile from '@/models/BlobFile';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { del } from '@vercel/blob';

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

// 清除用户的加密数据
export async function POST(req, { params }) {
    const admin = await requireAdmin();
    if (!admin) {
        return Response.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id);
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const userId = user._id;

    // 查找并删除包含加密数据的会话
    const conversations = await Conversation.find({ userId }).lean();
    let deletedConversations = 0;

    for (const conv of conversations) {
        let shouldDelete = false;

        // 检查 title
        if (hasEncryptedData(conv.title)) {
            shouldDelete = true;
        }

        // 检查 messages
        if (!shouldDelete && Array.isArray(conv.messages)) {
            for (const msg of conv.messages) {
                if (hasEncryptedData(msg.content) || 
                    hasEncryptedData(msg.thought) || 
                    hasEncryptedData(msg.parts)) {
                    shouldDelete = true;
                    break;
                }
            }
        }

        if (shouldDelete) {
            await Conversation.deleteOne({ _id: conv._id });
            deletedConversations++;
        }
    }

    // 查找并删除包含加密数据的设置
    const settings = await UserSettings.findOne({ userId }).lean();
    let deletedSettings = false;

    if (settings) {
        if (hasEncryptedData(settings.systemPrompts)) {
            await UserSettings.deleteOne({ userId });
            deletedSettings = true;
        }
    }

    return Response.json({ 
        success: true, 
        deletedConversations,
        deletedSettings
    });
}

// 重置用户密码
export async function PATCH(req, { params }) {
    const admin = await requireAdmin();
    if (!admin) {
        return Response.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id);
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    // 生成随机密码（12 位，包含大小写字母和数字）
    const newPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return Response.json({ success: true, newPassword });
}

// 删除用户及其所有数据
export async function DELETE(req, { params }) {
    const admin = await requireAdmin();
    if (!admin) {
        return Response.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    // 不能删除自己
    if (admin.userId === id) {
        return Response.json({ error: '不能删除自己的账号' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id);
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const userId = user._id;

    // 删除 Blob 文件（从 Vercel Blob 存储中清理）
    try {
        const blobs = await BlobFile.find({ userId }).select('url').lean();
        const urls = blobs.map(b => b.url).filter(Boolean);
        if (urls.length > 0) {
            await del(urls);
        }
    } catch (e) {
        console.error('清理 Blob 文件失败:', e?.message);
    }

    // 级联删除所有关联数据
    await Promise.all([
        Conversation.deleteMany({ userId }),
        UserSettings.deleteMany({ userId }),
        BlobFile.deleteMany({ userId }),
        User.deleteOne({ _id: userId }),
    ]);

    return Response.json({ success: true });
}
