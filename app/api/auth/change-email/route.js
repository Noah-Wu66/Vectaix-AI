import dbConnect from '@/lib/db';
import { getAuthPayload, signAuthToken, setAuthCookie } from '@/lib/auth';
import User from '@/models/User';
import bcrypt from 'bcryptjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req) {
  try {
    await dbConnect();
    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: '请求体格式错误' }, { status: 400 });
    }

    const { newEmail, password } = body || {};

    if (!newEmail || typeof newEmail !== 'string') {
      return Response.json({ error: '请输入新邮箱' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return Response.json({ error: '请输入当前密码' }, { status: 400 });
    }

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return Response.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }

    const userDoc = await User.findById(auth.userId);
    if (!userDoc) {
      return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    if (normalizedEmail === userDoc.email) {
      return Response.json({ error: '新邮箱与当前邮箱相同' }, { status: 400 });
    }

    const isMatch = await bcrypt.compare(password, userDoc.password);
    if (!isMatch) {
      return Response.json({ error: '密码错误' }, { status: 400 });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return Response.json({ error: '该邮箱已被其他用户使用' }, { status: 400 });
    }

    userDoc.email = normalizedEmail;
    await userDoc.save();

    // 重新签发 JWT
    const token = await signAuthToken({ userId: userDoc._id, email: normalizedEmail });
    await setAuthCookie(token);

    return Response.json({
      success: true,
      user: {
        id: userDoc._id.toString(),
        email: normalizedEmail,
      },
    });
  } catch (error) {
    console.error('Change email error:', error?.message);
    return Response.json({ error: '修改邮箱失败' }, { status: 500 });
  }
}
