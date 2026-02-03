import { del } from '@vercel/blob';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';

export const runtime = 'nodejs';

const RETENTION_DAYS = 90;
const BATCH_SIZE = 200;

function isCronRequest(request) {
    const ua = request.headers.get('user-agent') || '';
    return ua.includes('vercel-cron/1.0');
}

export async function GET(request) {
    if (!isCronRequest(request)) {
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
        if (urls.length === 0) break;

        await del(urls);
        await BlobFile.deleteMany({ url: { $in: urls } });
        totalDeleted += urls.length;
    }

    return Response.json({
        success: true,
        deleted: totalDeleted,
    });
}
