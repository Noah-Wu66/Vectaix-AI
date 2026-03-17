import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import ChatRun from '@/models/ChatRun';
import AgentRun from '@/models/AgentRun';
import { getAuthPayload } from '@/lib/auth';
import { sanitizeImportedConversation } from '@/lib/server/conversations/sanitize';
import { ACTIVE_AGENT_RUN_STATUSES, ACTIVE_CHAT_RUN_STATUSES } from '@/lib/shared/realtime';
import { publishConversationUpsert } from '@/lib/server/realtime/publishers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 2_000_000;

export async function GET() {
    try {
        await dbConnect();
        const user = await getAuthPayload();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const [conversations, activeChatRuns, activeAgentRuns] = await Promise.all([
            Conversation.find({ userId: user.userId })
                .sort({ pinned: -1, updatedAt: -1 })
                .select('title model updatedAt pinned')
                .lean(),
            ChatRun.find({ userId: user.userId, status: { $in: ACTIVE_CHAT_RUN_STATUSES } })
                .select('conversationId')
                .lean(),
            AgentRun.find({ userId: user.userId, status: { $in: ACTIVE_AGENT_RUN_STATUSES } })
                .select('conversationId')
                .lean(),
        ]);

        const activeConversationIds = new Set([
            ...activeChatRuns.map((run) => run?.conversationId?.toString?.() || ''),
            ...activeAgentRuns.map((run) => run?.conversationId?.toString?.() || ''),
        ].filter(Boolean));

        const nextConversations = conversations.map((conversation) => ({
            ...conversation,
            hasActiveRun: activeConversationIds.has(conversation?._id?.toString?.() || ''),
        }));

        return Response.json({ conversations: nextConversations });
    } catch (error) {
        console.error('Failed to fetch conversations:', error?.message);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
            return Response.json({ error: 'Request too large' }, { status: 413 });
        }

        await dbConnect();
        const user = await getAuthPayload();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        let body = null;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const conversationInput = sanitizeImportedConversation(body, 0, user.userId);
        const created = await Conversation.create({
            ...conversationInput,
            pinned: Boolean(conversationInput.pinned),
            updatedAt: new Date(),
        });

        await publishConversationUpsert({
            conversationId: created._id,
            userId: user.userId,
            conversation: created.toObject(),
            hasActiveRun: false,
        });

        return Response.json({ conversation: created.toObject() });
    } catch (error) {
        return Response.json({ error: error?.message || '创建会话失败' }, { status: 400 });
    }
}
