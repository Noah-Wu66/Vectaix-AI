import { del } from '@vercel/blob';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';

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
        if (urls.length === 0) {
            await BlobFile.deleteMany({ _id: { $in: expired.map((item) => item._id) } });
            continue;
        }

        await del(urls);
        await BlobFile.deleteMany({ url: { $in: urls } });
        totalDeleted += urls.length;
    }

    return Response.json({
        success: true,
        deleted: totalDeleted,
    });
}
