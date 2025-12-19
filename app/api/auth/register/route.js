import { SignJWT } from 'jose';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'default_secret_key_change_me');

export async function POST(req) {
    try {
        await dbConnect();
        const { email, password, confirmPassword } = await req.json();

        if (!email || !password || !confirmPassword) {
            return Response.json({ error: 'Missing fields' }, { status: 400 });
        }

        if (password !== confirmPassword) {
            return Response.json({ error: 'Passwords do not match' }, { status: 400 });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return Response.json({ error: 'User already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            email,
            password: hashedPassword,
        });

        // Auto Login: Create Session
        const token = await new SignJWT({ userId: user._id, email: user.email })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(SECRET_KEY);

        cookies().set('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/'
        });

        return Response.json({
            success: true,
            user: { id: user._id, email: user.email }
        });

    } catch (error) {
        console.error(error);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
