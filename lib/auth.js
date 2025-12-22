import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const TOKEN_COOKIE_NAME = 'token';
const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || 'default_secret_key_change_me',
);

export async function getAuthPayload() {
  const token = cookies().get(TOKEN_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, SECRET_KEY);
    return verified.payload;
  } catch {
    return null;
  }
}

export async function signAuthToken({ userId, email }) {
  const payload = {
    userId: userId?.toString?.() ?? String(userId),
    email,
  };

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET_KEY);
}

export function setAuthCookie(token) {
  cookies().set(TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
}

export function clearAuthCookie() {
  cookies().delete(TOKEN_COOKIE_NAME);
}


