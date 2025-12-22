import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';

export async function GET() {
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversations = await Conversation.find({ userId: user.userId })
        .sort({ updatedAt: -1 })
        .select('title updatedAt');

    return Response.json({ conversations });
}
