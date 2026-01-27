import dbConnect from '@/lib/db';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { signAuthToken, setAuthCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const OA_COOKIE_NAME = 'oa_token';

function getOaSecretKey() {
  const secret = process.env.OA_SSO_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function GET() {
  try {
    const secretKey = getOaSecretKey();
    if (!secretKey) {
      return Response.json({ error: '服务端未配置 OA_SSO_SECRET' }, { status: 500 });
    }

    const oaToken = cookies().get(OA_COOKIE_NAME)?.value;
    if (!oaToken) {
      return Response.json({ error: '未检测到企业登录状态' }, { status: 401 });
    }

    const { payload } = await jwtVerify(oaToken, secretKey);
    const rawEmail = String(payload?.email || '').trim().toLowerCase();
    const rawEmployeeId = String(payload?.employeeId || '').trim();
    const email = rawEmail || (rawEmployeeId ? `oa-${rawEmployeeId}@oa.vectaix.com` : '');
    if (!email) {
      return Response.json({ error: '企业登录信息缺少邮箱/工号' }, { status: 400 });
    }

    await dbConnect();

    let user = await User.findOne({ email });
    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString('base64url');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      user = await User.create({ email, password: hashedPassword });
    }

    const token = await signAuthToken({ userId: user._id, email: user.email });
    setAuthCookie(token);

    return Response.json({
      success: true,
      user: { id: user._id, email: user.email },
    });
  } catch (error) {
    console.error("Enterprise auth error:", error?.message);
    return Response.json({ error: '企业登录失败，请稍后再试' }, { status: 500 });
  }
}

