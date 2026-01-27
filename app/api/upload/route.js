import { handleUpload } from '@vercel/blob/client';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export async function POST(request) {
    const body = await request.json();
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
            onBeforeGenerateToken: async () => {
                // Authenticate
                if (!user) {
                    throw new Error('Not authorized');
                }

                return {
                    allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                    tokenPayload: JSON.stringify({
                        userId: user.userId,
                    }),
                };
            },
            onUploadCompleted: async () => {
                // 上传完成回调，Vercel Blob 服务器会调用此方法通知上传完成
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
