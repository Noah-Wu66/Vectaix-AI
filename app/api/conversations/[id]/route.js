import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import fs from 'fs'; // Auto-import fix if needed? No, using generic logic

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'default_secret_key_change_me');

async function getUser() {
    const token = cookies().get('token')?.value;
    if (!token) return null;
    try {
        const verified = await jwtVerify(token, SECRET_KEY);
        return verified.payload;
    } catch {
        return null;
    }
}

export async function GET(req, { params }) {
    await dbConnect();
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await Conversation.findOne({ _id: params.id, userId: user.userId });
    if (!conversation) return Response.json({ error: 'Not found' }, { status: 404 });

    return Response.json({ conversation });
}

export async function DELETE(req, { params }) {
    await dbConnect();
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    await Conversation.deleteOne({ _id: params.id, userId: user.userId });
    return Response.json({ success: true });
}

export async function PUT(req, { params }) {
    await dbConnect();
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { ...body, updatedAt: Date.now() },
        { new: true }
    );

    return Response.json({ conversation });
}
