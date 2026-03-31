import { headers } from 'next/headers';

/**
 * Validate that a state-changing request originates from the same site.
 * Checks the Origin header (or Referer fallback) against the Host header.
 *
 * @param {Request} req
 * @returns {{ valid: boolean, reason?: string }}
 */
export async function validateOrigin(req) {
  const method = req.method?.toUpperCase();

  // Only validate state-changing methods
  if (!method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { valid: true };
  }

  const hdrs = await headers();
  const origin = hdrs.get('origin');
  const referer = hdrs.get('referer');
  const host = hdrs.get('host') || hdrs.get('x-forwarded-host');

  if (!host) {
    // Can't validate without a Host header – allow in dev, block in prod
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, reason: 'Missing Host header' };
    }
    return { valid: true };
  }

  const normalizedHost = host.split(':')[0].toLowerCase();

  // Check Origin header first (most reliable)
  if (origin) {
    try {
      const originHost = new URL(origin).hostname.toLowerCase();
      if (originHost === normalizedHost) {
        return { valid: true };
      }
      return { valid: false, reason: `Origin mismatch: ${originHost} vs ${normalizedHost}` };
    } catch {
      return { valid: false, reason: 'Invalid Origin header' };
    }
  }

  // Fallback to Referer header
  if (referer) {
    try {
      const refererHost = new URL(referer).hostname.toLowerCase();
      if (refererHost === normalizedHost) {
        return { valid: true };
      }
      return { valid: false, reason: `Referer mismatch: ${refererHost} vs ${normalizedHost}` };
    } catch {
      return { valid: false, reason: 'Invalid Referer header' };
    }
  }

  // No Origin or Referer – some legitimate clients may not send them.
  // In production, block requests without origin info for safety.
  if (process.env.NODE_ENV === 'production') {
    return { valid: false, reason: 'Missing Origin and Referer headers' };
  }

  return { valid: true };
}

/**
 * Helper to return a 403 CSRF error response.
 */
export function csrfForbiddenResponse() {
  return Response.json(
    { error: 'Forbidden: cross-origin request blocked' },
    { status: 403 }
  );
}
