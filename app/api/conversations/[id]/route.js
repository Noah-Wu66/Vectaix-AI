import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';

const ALLOWED_MESSAGE_TYPES = new Set(['text', 'parts', 'error']);

export async function GET(req, { params }) {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await Conversation.findOne({ _id: params.id, userId: user.userId });
    if (!conversation) return Response.json({ error: 'Not found' }, { status: 404 });

    for (const msg of conversation.messages || []) {
        if (!ALLOWED_MESSAGE_TYPES.has(msg?.type)) {
            return Response.json({ error: 'Outdated conversation: unsupported message type' }, { status: 409 });
        }
    }

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

    const body = await req.json();
    if (Array.isArray(body?.messages)) {
        for (const msg of body.messages) {
            if (!ALLOWED_MESSAGE_TYPES.has(msg?.type)) {
                return Response.json({ error: 'Outdated conversation: unsupported message type' }, { status: 409 });
            }
        }
    }

    // 构建更新对象，支持 settings 的部分更新
    const updateObj = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(body)) {
        if (key === 'settings' && typeof value === 'object' && value !== null) {
            // 对 settings 进行部分更新（使用点号表示法）
            for (const [settingKey, settingValue] of Object.entries(value)) {
                updateObj[`settings.${settingKey}`] = settingValue;
            }
        } else {
            updateObj[key] = value;
        }
    }

    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { $set: updateObj },
        { new: true }
    );

    return Response.json({ conversation });
}
