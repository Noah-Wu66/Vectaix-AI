import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { signAuthToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

// Rate limit: 5 login attempts per minute per IP
const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 60 * 1000 };

export async function POST(req) {
    try {
        // Apply rate limiting
        const clientIP = getClientIP(req);
        const rateLimitKey = `login:${clientIP}`;
        const { success, remaining, resetTime } = rateLimit(rateLimitKey, LOGIN_RATE_LIMIT);

        if (!success) {
            const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
            return Response.json(
                { error: '登录尝试次数过多，请稍后再试' },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(retryAfter),
                        'X-RateLimit-Remaining': '0',
                    },
                }
            );
        }

        await dbConnect();
        let body;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: '请求体格式错误' }, { status: 400 });
        }

        const { email, password } = body || {};
        if (typeof email !== 'string' || typeof password !== 'string') {
            return Response.json({ error: '邮箱和密码格式错误' }, { status: 400 });
        }

        if (!email.trim() || !password) {
            return Response.json({ error: '请填写邮箱和密码' }, { status: 400 });
        }

        // Normalize email to match stored format
        const normalizedEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return Response.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return Response.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        const token = await signAuthToken({ userId: user._id, email: user.email });
        setAuthCookie(token);

        return Response.json({
            success: true,
            user: { id: user._id, email: user.email }
        });

    } catch (error) {
        console.error('Login error:', error?.message);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
