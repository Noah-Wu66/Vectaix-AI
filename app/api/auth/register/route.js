import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { signAuthToken, setAuthCookie } from '@/lib/auth';

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
        const token = await signAuthToken({ userId: user._id, email: user.email });
        setAuthCookie(token);

        return Response.json({
            success: true,
            user: { id: user._id, email: user.email }
        });

    } catch (error) {
        console.error(error);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
