import dbConnect from '@/lib/db';
import UserSettings from '@/models/UserSettings';
import { getAuthPayload } from '@/lib/auth';

// 获取用户设置（只返回系统提示词）
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
    settings.updatedAt = Date.now();
    await settings.save();

    return Response.json({ settings });
}

// 更新用户头像
export async function PUT(req) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { avatar } = await req.json();

    let settings = await UserSettings.findOne({ userId: user.userId });

    if (!settings) {
        settings = await UserSettings.create({
            userId: user.userId,
            avatar: avatar || null,
            systemPrompts: [{ name: '默认助手', content: 'You are a helpful AI assistant.' }]
        });
    } else {
        settings.avatar = avatar || null;
        settings.updatedAt = Date.now();
        await settings.save();
    }

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

    return Response.json({ settings });
}
