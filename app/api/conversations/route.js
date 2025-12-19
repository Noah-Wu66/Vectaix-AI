import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';

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

export async function GET() {
    await dbConnect();
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversations = await Conversation.find({ userId: user.userId })
        .sort({ updatedAt: -1 })
        .select('title updatedAt');

    return Response.json({ conversations });
}

export async function POST(req) {
    await dbConnect();
    const user = await getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messages = [], title = "New Chat" } = await req.json();

    const conversation = await Conversation.create({
        userId: user.userId,
        title,
        messages
    });

    return Response.json({ conversation });
}
