import { del } from '@vercel/blob';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';
import AgentRun from '@/models/AgentRun';
import Conversation from '@/models/Conversation';
import { AGENT_STALE_RUN_MS, buildAgentMessageMeta } from '@/lib/server/agent/runHelpers';

export const runtime = 'nodejs';

const RETENTION_DAYS = 90;
const BATCH_SIZE = 200;
const CRON_SECRET = process.env.CRON_SECRET;

function isCronRequestAuthorized(request) {
    if (!CRON_SECRET) return false;

    const authorization = request.headers.get('authorization');
    if (!authorization || typeof authorization !== 'string') return false;
    return authorization === `Bearer ${CRON_SECRET}`;
}

export async function GET(request) {
    if (!CRON_SECRET) {
        return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
    }

    if (!isCronRequestAuthorized(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const staleCutoff = new Date(Date.now() - AGENT_STALE_RUN_MS);

    let totalDeleted = 0;

    while (true) {
        const expired = await BlobFile.find({
            kind: { $in: ['chat', 'agent-artifact'] },
            createdAt: { $lte: cutoff },
        })
            .select('url')
            .limit(BATCH_SIZE);

        if (expired.length === 0) break;

        const urls = expired.map((item) => item.url).filter(Boolean);
        if (urls.length === 0) {
            await BlobFile.deleteMany({ _id: { $in: expired.map((item) => item._id) } });
            continue;
        }

        await del(urls);
        await BlobFile.deleteMany({ url: { $in: urls } });
        totalDeleted += urls.length;
    }

    const staleRuns = await AgentRun.find({
        status: 'running',
        lastHeartbeatAt: { $lte: staleCutoff },
    }).select('_id executionState');

    let staleRunCount = 0;
    if (staleRuns.length > 0) {
        const runIds = staleRuns.map((item) => item._id);
        await AgentRun.updateMany(
          {
            _id: { $in: runIds },
            status: 'running',
            lastHeartbeatAt: { $lte: staleCutoff },
          },
          {
            $set: {
              status: 'waiting_continue',
              executionState: 'waiting_continue',
              currentStep: '等待继续执行',
              updatedAt: new Date(),
              lease: null,
            },
          }
        );
        const refreshedRuns = await AgentRun.find({ _id: { $in: runIds } });
        for (const run of refreshedRuns) {
          const conversation = await Conversation.findById(run.conversationId).select('messages');
          if (!conversation) continue;
          const nextMessages = Array.isArray(conversation.messages)
            ? conversation.messages.map((item) => (item?.toObject ? item.toObject() : item))
            : [];
          const index = nextMessages.findIndex((item) => item?.agentRun?.runId === run._id.toString());
          if (index < 0) continue;
          nextMessages[index] = {
            ...nextMessages[index],
            content: '任务处理中断，已切换为可继续执行状态。',
            parts: [{ text: '任务处理中断，已切换为可继续执行状态。' }],
            agentRun: buildAgentMessageMeta(run, {
              status: 'waiting_continue',
              executionState: 'waiting_continue',
              canResume: true,
            }),
          };
          await Conversation.updateOne(
            { _id: run.conversationId },
            { $set: { messages: nextMessages, updatedAt: Date.now() } }
          );
        }
        staleRunCount = refreshedRuns.length;
    }

    return Response.json({
        success: true,
        deleted: totalDeleted,
        staleRunsRecovered: staleRunCount,
    });
}
