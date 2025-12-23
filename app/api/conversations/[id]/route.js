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
    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { ...body, updatedAt: Date.now() },
        { new: true }
    );

    return Response.json({ conversation });
}
