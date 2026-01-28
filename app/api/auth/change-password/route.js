import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { getAuthPayload } from '@/lib/auth';

// Password requirements: at least 8 chars, 1 uppercase, 1 lowercase, 1 number
const PASSWORD_MIN_LENGTH = 8;

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

export async function POST(req) {
    try {
        await dbConnect();
        const auth = await getAuthPayload();
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { oldPassword, newPassword, confirmNewPassword } = await req.json();

        if (!oldPassword || !newPassword || !confirmNewPassword) {
            return Response.json({ error: 'Missing fields' }, { status: 400 });
        }

        if (newPassword !== confirmNewPassword) {
            return Response.json({ error: 'New passwords do not match' }, { status: 400 });
        }

        // specific Fetch for password
        const userDoc = await User.findById(auth.userId);
        if (!userDoc) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Verify Old Password
        const isMatch = await bcrypt.compare(oldPassword, userDoc.password);
        if (!isMatch) {
            return Response.json({ error: 'Incorrect old password' }, { status: 400 });
        }

        // Validate new password strength
        const passwordCheck = validatePassword(newPassword);
        if (!passwordCheck.valid) {
            return Response.json({ error: passwordCheck.message }, { status: 400 });
        }

        // Hash New
        const hashedNew = await bcrypt.hash(newPassword, 10);
        userDoc.password = hashedNew;
        await userDoc.save();

        return Response.json({ success: true });

    } catch (error) {
        console.error('Change password error:', error?.message);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
