import { clearAuthCookie, getAuthPayload } from '@/lib/auth';

export async function GET() {
    const payload = await getAuthPayload();
    if (!payload) return Response.json({ user: null });

    return Response.json({
        user: {
            id: payload.userId,
            email: payload.email
        }
    });
}

export async function DELETE() {
    clearAuthCookie();
    return Response.json({ success: true });
}
