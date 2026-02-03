import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const TOKEN_COOKIE_NAME = 'token';

// Validate JWT_SECRET at module load time
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is not set. Please set it in your .env file.'
  );
}

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET);

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
    userId: userId?.toString?.(),
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
