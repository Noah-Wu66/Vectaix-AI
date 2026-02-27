import { handleUpload } from '@vercel/blob/client';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';

const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const user = await getAuthPayload();

    const clientIP = getClientIP(request);
    const rateLimitKey = `upload:${user?.userId || 'anon'}:${clientIP}`;
    const { success, resetTime } = rateLimit(rateLimitKey, UPLOAD_RATE_LIMIT);
    if (!success) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        return Response.json(
            { error: '上传过于频繁，请稍后再试' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(retryAfter),
                    'X-RateLimit-Remaining': '0',
                },
            }
        );
    }

    try {
        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
                // Authenticate
                if (!user) {
                    throw new Error('Not authorized');
                }

                let kind = 'chat';
                if (typeof clientPayload === 'string' && clientPayload) {
                    try {
                        const parsed = JSON.parse(clientPayload);
                        if (parsed?.kind === 'avatar') kind = 'avatar';
                    } catch {
                        // ignore invalid payload
                    }
                }

                return {
                    allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                    tokenPayload: JSON.stringify({
                        userId: user.userId,
                        kind,
                    }),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                try {
                    const payload = tokenPayload ? JSON.parse(tokenPayload) : null;
                    const userId = payload?.userId;
                    const kind = payload?.kind === 'avatar' ? 'avatar' : 'chat';
                    if (!userId || !blob?.url) return;

                    await dbConnect();
                    await BlobFile.findOneAndUpdate(
                        { url: blob.url },
                        {
                            $setOnInsert: {
                                userId,
                                url: blob.url,
                                pathname: blob.pathname,
                                kind,
                                createdAt: new Date(),
                            },
                        },
                        { upsert: true }
                    );
                } catch { }
            },
        });

        return Response.json(jsonResponse);
    } catch (error) {
        return Response.json(
            { error: error.message },
            { status: 400 },
        );
    }
}
