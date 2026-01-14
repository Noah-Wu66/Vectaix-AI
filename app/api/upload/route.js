import { handleUpload } from '@vercel/blob/client';
import { getAuthPayload } from '@/lib/auth';

export async function POST(request) {
    const body = await request.json();
    const user = await getAuthPayload();

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
                        email: user.email,
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
