import { handleUpload } from '@vercel/blob/client';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'default_secret_key_change_me');

async function getUser(req) {
    const token = cookies().get('token')?.value;
    if (!token) return null;
    try {
        const verified = await jwtVerify(token, SECRET_KEY);
        return verified.payload;
    } catch {
        return null;
    }
}

export async function POST(request) {
    const body = await request.json();

    try {
        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (pathname) => {
                // Authenticate
                const user = await getUser(request);
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
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                console.log('blob upload completed', blob, tokenPayload);
                // We could save to DB here, but we will save in the chat flow to link it to the conversation/message
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
