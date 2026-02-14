import { clearAuthCookie, getAuthPayload } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import dbConnect from '@/lib/db';
import User from '@/models/User';

export async function GET() {
    const payload = await getAuthPayload();
    if (!payload) return Response.json({ user: null });

    let isPremium = false;
    try {
        await dbConnect();
        const userDoc = await User.findById(payload.userId).select('premium').lean();
        isPremium = !!userDoc?.premium;
    } catch { /* ignore */ }

    return Response.json({
        user: {
            id: payload.userId,
            email: payload.email,
            isAdmin: isAdminEmail(payload.email),
            isPremium,
        }
    });
}

export async function DELETE() {
    clearAuthCookie();
    return Response.json({ success: true });
}
