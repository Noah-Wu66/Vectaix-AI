import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        await dbConnect();
        const user = await getAuthPayload();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const conversations = await Conversation.find({ userId: user.userId })
            .sort({ pinned: -1, updatedAt: -1 })
            .select('title model updatedAt pinned')
            .lean();

        return Response.json({ conversations });
    } catch (error) {
        console.error('Failed to fetch conversations:', error?.message);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
