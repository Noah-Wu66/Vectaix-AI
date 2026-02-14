import { clearAuthCookie, getAuthPayload } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import dbConnect from '@/lib/db';
import User from '@/models/User';

export async function GET() {
    const payload = await getAuthPayload();
    if (!payload) return Response.json({ user: null });

    const isAdmin = isAdminEmail(payload.email);
    let isPremium = isAdmin;
    try {
        await dbConnect();
        const userDoc = await User.findById(payload.userId).select('premium').lean();
        if (userDoc?.premium) isPremium = true;
    } catch { /* ignore */ }

    return Response.json({
        user: {
            id: payload.userId,
            email: payload.email,
            isAdmin,
            isPremium,
        }
    });
}

export async function DELETE() {
    clearAuthCookie();
    return Response.json({ success: true });
}
