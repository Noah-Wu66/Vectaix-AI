import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';

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

    const body = await req.json();
    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { ...body, updatedAt: Date.now() },
        { new: true }
    );

    return Response.json({ conversation });
}
