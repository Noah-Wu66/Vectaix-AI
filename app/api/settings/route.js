import dbConnect from '@/lib/db';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureThinkingLevels(settings) {
    const levels = settings?.thinkingLevels;
    if (!isPlainObject(levels)) {
        return { ok: false, error: 'Outdated settings: missing thinkingLevels' };
    }
    return { ok: true };
}

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
        settings.activeSystemPromptIds = { [settings.model]: settings.systemPrompts[0]._id };
        await settings.save();
    }

    const ok = ensureThinkingLevels(settings);
    if (!ok.ok) return Response.json({ error: ok.error }, { status: 409 });

    return Response.json({ settings });
}

// 更新用户设置
export async function PUT(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const updates = await req.json();
    // UI 设置不入库：themeMode/fontSize 走本地 localStorage
    const { themeMode, fontSize, ...dbUpdates } = updates || {};

    let settings = await UserSettings.findOne({ userId: user.userId });

    if (!settings) {
        settings = await UserSettings.create({
            userId: user.userId,
            systemPrompts: [{ name: '默认助手', content: 'You are a helpful AI assistant.' }],
            ...dbUpdates
        });
        settings.activeSystemPromptId = settings.systemPrompts[0]._id;
        if (!isPlainObject(settings.activeSystemPromptIds)) settings.activeSystemPromptIds = {};
        settings.activeSystemPromptIds[settings.model] = settings.activeSystemPromptId;
        await settings.save();
    } else {
        const ok = ensureThinkingLevels(settings);
        if (!ok.ok) return Response.json({ error: ok.error }, { status: 409 });

        // thinkingLevels 允许局部更新：{ thinkingLevels: { [modelId]: level } }
        if (isPlainObject(updates?.thinkingLevels)) {
            settings.thinkingLevels = { ...(settings.thinkingLevels || {}), ...updates.thinkingLevels };
        }

        // activeSystemPromptIds 允许局部更新：{ activeSystemPromptIds: { [modelId]: promptId } }
        if (isPlainObject(updates?.activeSystemPromptIds)) {
            settings.activeSystemPromptIds = { ...(settings.activeSystemPromptIds || {}), ...updates.activeSystemPromptIds };
        }

        const { thinkingLevels, activeSystemPromptIds, userId, systemPrompts, updatedAt, themeMode, fontSize, ...rest } = dbUpdates || {};
        Object.assign(settings, rest, { updatedAt: Date.now() });
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
        settings.activeSystemPromptIds = { [settings.model]: settings.systemPrompts[0]._id };
        await settings.save();
    } else {
        const ok = ensureThinkingLevels(settings);
        if (!ok.ok) return Response.json({ error: ok.error }, { status: 409 });

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

    const ok = ensureThinkingLevels(settings);
    if (!ok.ok) return Response.json({ error: ok.error }, { status: 409 });

    // 防止删除最后一个提示词
    if (settings.systemPrompts.length <= 1) {
        return Response.json({ error: 'Cannot delete the last prompt' }, { status: 400 });
    }

    settings.systemPrompts = settings.systemPrompts.filter(p => p._id.toString() !== promptId);

    // 如果删除的是当前激活的，切换到第一个
    if (settings.activeSystemPromptId?.toString() === promptId) {
        settings.activeSystemPromptId = settings.systemPrompts[0]._id;
    }

    // 同步按模型映射：凡是指向被删除提示词的，都切到第一个
    if (isPlainObject(settings.activeSystemPromptIds)) {
        const nextDefaultId = settings.systemPrompts[0]?._id;
        for (const k of Object.keys(settings.activeSystemPromptIds)) {
            if (String(settings.activeSystemPromptIds[k]) === String(promptId)) {
                settings.activeSystemPromptIds[k] = nextDefaultId;
            }
        }
    }

    settings.updatedAt = Date.now();
    await settings.save();

    return Response.json({ settings });
}

// 编辑系统提示词
export async function PATCH(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { promptId, name, content } = await req.json();
    if (!promptId || !name || !content) {
        return Response.json({ error: 'promptId, name and content are required' }, { status: 400 });
    }

    const settings = await UserSettings.findOne({ userId: user.userId });
    if (!settings) return Response.json({ error: 'Settings not found' }, { status: 404 });

    const ok = ensureThinkingLevels(settings);
    if (!ok.ok) return Response.json({ error: ok.error }, { status: 409 });

    const p = settings.systemPrompts?.id?.(promptId);
    if (!p) return Response.json({ error: 'Prompt not found' }, { status: 404 });

    p.name = String(name);
    p.content = String(content);
    settings.updatedAt = Date.now();
    await settings.save();

    return Response.json({ settings });
}