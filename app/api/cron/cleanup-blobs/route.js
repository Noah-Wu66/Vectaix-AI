import { del, list } from '@vercel/blob';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';

const CRON_SECRET = process.env.CRON_SECRET;

// Blobs older than this with no references are considered orphaned
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request) {
    // Verify cron secret to prevent unauthorized execution
    if (CRON_SECRET) {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${CRON_SECRET}`) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        await dbConnect();

        const cutoff = new Date(Date.now() - ORPHAN_AGE_MS);

        // Step 1: Find BlobFile records older than cutoff
        const candidates = await BlobFile.find({
            createdAt: { $lt: cutoff },
        })
            .select('_id url userId kind')
            .lean();

        if (candidates.length === 0) {
            return Response.json({ deleted: 0, message: 'No orphan candidates found' });
        }

        // Step 2: Collect all blob URLs still referenced in conversations
        const referencedUrls = new Set();

        // 2a: Scan conversations for blob URLs in message parts
        const conversations = await Conversation.find({})
            .select('messages.parts')
            .lean();

        for (const conv of conversations) {
            if (!Array.isArray(conv.messages)) continue;
            for (const msg of conv.messages) {
                if (!Array.isArray(msg.parts)) continue;
                for (const part of msg.parts) {
                    if (part?.inlineData?.url) referencedUrls.add(part.inlineData.url);
                    if (part?.fileData?.url) referencedUrls.add(part.fileData.url);
                }
            }
        }

        // 2b: Scan user settings for avatar blob URLs
        const settings = await UserSettings.find({ avatar: { $ne: null } })
            .select('avatar')
            .lean();

        for (const s of settings) {
            if (s.avatar) referencedUrls.add(s.avatar);
        }

        // Step 3: Filter to orphaned blobs (not referenced anywhere)
        const orphaned = candidates.filter((b) => !referencedUrls.has(b.url));

        if (orphaned.length === 0) {
            return Response.json({ deleted: 0, message: 'No orphaned blobs found' });
        }

        // Step 4: Delete from Vercel Blob storage in batches
        const BATCH_SIZE = 100;
        const orphanedUrls = orphaned.map((b) => b.url).filter(Boolean);
        let deletedFromStorage = 0;

        for (let i = 0; i < orphanedUrls.length; i += BATCH_SIZE) {
            const batch = orphanedUrls.slice(i, i + BATCH_SIZE);
            try {
                await del(batch);
                deletedFromStorage += batch.length;
            } catch (e) {
                console.error(`Failed to delete blob batch ${i}-${i + batch.length}:`, e?.message);
            }
        }

        // Step 5: Delete database records
        const orphanedIds = orphaned.map((b) => b._id);
        await BlobFile.deleteMany({ _id: { $in: orphanedIds } });

        console.log(`Blob cleanup: deleted ${orphaned.length} orphaned records, ${deletedFromStorage} from storage`);

        return Response.json({
            deleted: orphaned.length,
            deletedFromStorage,
            message: `Cleaned up ${orphaned.length} orphaned blob(s)`,
        });
    } catch (error) {
        console.error('Blob cleanup cron error:', error?.message);
        return Response.json(
            { error: 'Cleanup failed', message: error?.message },
            { status: 500 }
        );
    }
}
