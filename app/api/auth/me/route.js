import { clearAuthCookie, getAuthPayload } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';

export async function GET() {
    const payload = await getAuthPayload();
    if (!payload) return Response.json({ user: null });

    const isAdmin = isAdminEmail(payload.email);

    return Response.json({
        user: {
            id: payload.userId,
            email: payload.email,
            isAdmin,
        }
    });
}

export async function DELETE() {
    clearAuthCookie();
    return Response.json({ success: true });
}
