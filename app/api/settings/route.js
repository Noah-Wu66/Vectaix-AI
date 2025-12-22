import dbConnect from '@/lib/db';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

// 获取用户设置
export async function GET() {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let settings = await UserSettings.findOne({ userId: user.userId });

    // 如果没有设置，创建默认设置
    if (!settings) {
        settings = await UserSettings.create({
            userId: user.userId,
            systemPrompts: [{ name: '默认助手', content: 'You are a helpful AI assistant.' }]
        });
        // 设置默认激活的提示词
        settings.activeSystemPromptId = settings.systemPrompts[0]._id;
        await settings.save();
    }

    return Response.json({ settings });
}

// 更新用户设置
export async function PUT(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const updates = await req.json();

    let settings = await UserSettings.findOne({ userId: user.userId });

    if (!settings) {
        settings = await UserSettings.create({
            userId: user.userId,
            ...updates
        });
    } else {
        Object.assign(settings, updates, { updatedAt: Date.now() });
        await settings.save();
    }

    return Response.json({ settings });
}

// 添加系统提示词
export async function POST(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, content } = await req.json();

    if (!name || !content) {
        return Response.json({ error: 'Name and content are required' }, { status: 400 });
    }

    let settings = await UserSettings.findOne({ userId: user.userId });

    if (!settings) {
        settings = await UserSettings.create({
            userId: user.userId,
            systemPrompts: [{ name, content }]
        });
        settings.activeSystemPromptId = settings.systemPrompts[0]._id;
        await settings.save();
    } else {
        settings.systemPrompts.push({ name, content });
        settings.updatedAt = Date.now();
        await settings.save();
    }

    return Response.json({ settings });
}

// 删除系统提示词
export async function DELETE(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { promptId } = await req.json();

    const settings = await UserSettings.findOne({ userId: user.userId });
    if (!settings) return Response.json({ error: 'Settings not found' }, { status: 404 });

    // 防止删除最后一个提示词
    if (settings.systemPrompts.length <= 1) {
        return Response.json({ error: 'Cannot delete the last prompt' }, { status: 400 });
    }

    settings.systemPrompts = settings.systemPrompts.filter(p => p._id.toString() !== promptId);

    // 如果删除的是当前激活的，切换到第一个
    if (settings.activeSystemPromptId?.toString() === promptId) {
        settings.activeSystemPromptId = settings.systemPrompts[0]._id;
    }

    settings.updatedAt = Date.now();
    await settings.save();

    return Response.json({ settings });
}
