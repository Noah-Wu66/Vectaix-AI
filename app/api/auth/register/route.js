import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { signAuthToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password requirements: at least 8 chars, 1 uppercase, 1 lowercase, 1 number
const PASSWORD_MIN_LENGTH = 8;

function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return EMAIL_REGEX.test(email.trim());
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return { valid: false, message: '密码不能为空' };
    if (password.length < PASSWORD_MIN_LENGTH) {
        return { valid: false, message: `密码长度至少为 ${PASSWORD_MIN_LENGTH} 个字符` };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: '密码必须包含至少一个大写字母' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, message: '密码必须包含至少一个小写字母' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, message: '密码必须包含至少一个数字' };
    }
    return { valid: true };
}

// Rate limit: 3 register attempts per 10 minutes per IP
const REGISTER_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 };

export async function POST(req) {
    try {
        // Apply rate limiting
        const clientIP = getClientIP(req);
        const rateLimitKey = `register:${clientIP}`;
        const { success, resetTime } = rateLimit(rateLimitKey, REGISTER_RATE_LIMIT);

        if (!success) {
            const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
            return Response.json(
                { error: '注册尝试次数过多，请稍后再试' },
                {
                    status: 429,
                    headers: { 'Retry-After': String(retryAfter) },
                }
            );
        }

        await dbConnect();
        const { email, password, confirmPassword } = await req.json();

        if (!email || !password || !confirmPassword) {
            return Response.json({ error: '请填写所有必填字段' }, { status: 400 });
        }

        // Normalize email: trim whitespace and convert to lowercase
        const normalizedEmail = email.trim().toLowerCase();

        // Validate email format
        if (!validateEmail(normalizedEmail)) {
            return Response.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
        }

        // Validate password strength
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
            return Response.json({ error: passwordCheck.message }, { status: 400 });
        }

        if (password !== confirmPassword) {
            return Response.json({ error: '两次输入的密码不一致' }, { status: 400 });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return Response.json({ error: 'User already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            email: normalizedEmail,
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
        console.error('Register error:', error?.message);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
