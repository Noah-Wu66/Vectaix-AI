import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'default_secret_key_change_me');

export async function GET() {
    const token = cookies().get('token')?.value;

    if (!token) {
        return Response.json({ user: null });
    }

    try {
        const verified = await jwtVerify(token, SECRET_KEY);
        return Response.json({
            user: {
                id: verified.payload.userId,
                email: verified.payload.email
            }
        });
    } catch (err) {
        return Response.json({ user: null });
    }
}

export async function DELETE() {
    cookies().delete('token');
    return Response.json({ success: true });
}
