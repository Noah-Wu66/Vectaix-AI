import { NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware – runs before every matched request.
 * Currently handles:
 *   1. CSRF Origin validation for state-changing API requests
 */

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getHostname(value) {
  if (!value) return null;
  try {
    // Origin is a full URL, Host is just hostname:port
    if (value.startsWith('http')) {
      return new URL(value).hostname.toLowerCase();
    }
    return value.split(':')[0].toLowerCase();
  } catch {
    return null;
  }
}

export function middleware(request) {
  const { method, headers } = request;

  // Only validate state-changing methods on API routes
  if (!STATE_CHANGING_METHODS.has(method)) {
    return NextResponse.next();
  }

  const host = headers.get('host') || headers.get('x-forwarded-host');
  if (!host) {
    // If no host header, skip in dev but block in prod
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Forbidden: missing Host header' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  const normalizedHost = getHostname(host);
  const origin = headers.get('origin');
  const referer = headers.get('referer');

  // Check Origin header (preferred)
  if (origin) {
    const originHost = getHostname(origin);
    if (originHost && originHost === normalizedHost) {
      return NextResponse.next();
    }
    if (originHost && originHost !== normalizedHost) {
      return NextResponse.json(
        { error: 'Forbidden: cross-origin request blocked' },
        { status: 403 }
      );
    }
  }

  // Fallback to Referer header
  if (referer) {
    const refererHost = getHostname(referer);
    if (refererHost && refererHost === normalizedHost) {
      return NextResponse.next();
    }
    if (refererHost && refererHost !== normalizedHost) {
      return NextResponse.json(
        { error: 'Forbidden: cross-origin request blocked' },
        { status: 403 }
      );
    }
  }

  // No Origin or Referer: block in production, allow in dev
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Forbidden: missing origin information' },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

// Only apply to API routes (state-changing operations)
export const config = {
  matcher: '/api/:path*',
};
