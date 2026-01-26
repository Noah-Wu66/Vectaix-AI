import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';

const ALLOWED_UPDATE_KEYS = new Set(['title', 'messages', 'settings']);
const ALLOWED_SETTINGS_KEYS = new Set(['thinkingLevel', 'historyLimit', 'maxTokens', 'budgetTokens', 'activePromptId']);

export async function GET(req, { params }) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await Conversation.findOne({ _id: params.id, userId: user.userId });
    if (!conversation) return Response.json({ error: 'Not found' }, { status: 404 });

    return Response.json({ conversation });
}

export async function DELETE(req, { params }) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    await Conversation.deleteOne({ _id: params.id, userId: user.userId });
    return Response.json({ success: true });
}

export async function PUT(req, { params }) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    for (const key of Object.keys(body)) {
        if (!ALLOWED_UPDATE_KEYS.has(key)) {
            return Response.json({ error: 'Unsupported field in request body' }, { status: 400 });
        }
    }

    if (body?.messages !== undefined && !Array.isArray(body.messages)) {
        return Response.json({ error: 'messages must be an array' }, { status: 400 });
    }

    if (body?.settings !== undefined) {
        if (typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
            return Response.json({ error: 'settings must be an object' }, { status: 400 });
        }
    }

    // 构建更新对象，支持 settings 的部分更新
    const updateObj = { updatedAt: Date.now() };
    if (typeof body.title === 'string') {
        updateObj.title = body.title;
    }

    if (Array.isArray(body.messages)) {
        updateObj.messages = body.messages;
    }

    if (body.settings && typeof body.settings === 'object') {
        for (const [settingKey, settingValue] of Object.entries(body.settings)) {
            if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
            updateObj[`settings.${settingKey}`] = settingValue;
        }
    }

    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { $set: updateObj },
        { new: true }
    );

    return Response.json({ conversation });
}
