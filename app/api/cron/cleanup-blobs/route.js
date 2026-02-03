import { del, list } from '@vercel/blob';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';
import BlobCleanupState from '@/models/BlobCleanupState';
import UserSettings from '@/models/UserSettings';

export const runtime = 'nodejs';

const RETENTION_DAYS = 30;
const BATCH_SIZE = 200;
const LIST_LIMIT = 1000;

function isCronRequest(request) {
    const ua = request.headers.get('user-agent') || '';
    return ua.includes('vercel-cron/1.0');
}

export async function GET(request) {
    if (!isCronRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    let initialDeleted = 0;
    let initialPreserved = 0;
    const initialState = await BlobCleanupState.findOne({ key: 'initial-cleanup' });
    if (!initialState) {
        const avatarSettings = await UserSettings.find({ avatar: { $type: 'string' } })
            .select('avatar');
        const avatarUrls = new Set(
            avatarSettings
                .map((s) => (typeof s.avatar === 'string' ? s.avatar.trim() : ''))
                .filter(Boolean)
        );

        let cursor;
        while (true) {
            const result = await list({ limit: LIST_LIMIT, cursor });
            const urls = (result?.blobs || []).map((b) => b.url).filter(Boolean);
            const toDelete = [];
            for (const url of urls) {
                if (avatarUrls.has(url)) {
                    initialPreserved += 1;
                } else {
                    toDelete.push(url);
                }
            }

            if (toDelete.length > 0) {
                await del(toDelete);
                initialDeleted += toDelete.length;
            }

            if (!result?.hasMore) break;
            cursor = result?.cursor;
        }

        if (avatarUrls.size > 0) {
            await BlobFile.deleteMany({ url: { $nin: Array.from(avatarUrls) } });
        } else {
            await BlobFile.deleteMany({});
        }

        await BlobCleanupState.updateOne(
            { key: 'initial-cleanup' },
            { $set: { doneAt: new Date() } },
            { upsert: true }
        );
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    let totalDeleted = 0;

    while (true) {
        const expired = await BlobFile.find({
            kind: 'chat',
            createdAt: { $lte: cutoff },
        })
            .select('url')
            .limit(BATCH_SIZE);

        if (expired.length === 0) break;

        const urls = expired.map((item) => item.url).filter(Boolean);
        if (urls.length === 0) break;

        await del(urls);
        await BlobFile.deleteMany({ url: { $in: urls } });
        totalDeleted += urls.length;
    }

    return Response.json({
        success: true,
        deleted: totalDeleted,
        initialDeleted,
        initialPreserved,
    });
}
