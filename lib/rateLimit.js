/**
 * Simple in-memory rate limiter for serverless environments
 * Note: For production with multiple instances, consider using Redis
 */

const rateLimitMap = new Map();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
let lastCleanup = Date.now();

function cleanup(windowMs) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  const cutoff = now - windowMs;

  for (const [key, data] of rateLimitMap.entries()) {
    if (data.resetTime < cutoff) {
      rateLimitMap.delete(key);
    }
  }
}

/**
 * Rate limit function
 * @param {string} key - Unique identifier (e.g., IP + endpoint)
 * @param {Object} options - Rate limit options
 * @param {number} options.limit - Max requests per window
 * @param {number} options.windowMs - Time window in milliseconds
 * @returns {{ success: boolean, remaining: number, resetTime: number }}
 */
export function rateLimit(key, { limit = 5, windowMs = 60 * 1000 } = {}) {
  cleanup(windowMs);

  const now = Date.now();
  const data = rateLimitMap.get(key);

  if (!data || now > data.resetTime) {
    // Start new window
    const resetTime = now + windowMs;
    rateLimitMap.set(key, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime };
  }

  if (data.count >= limit) {
    // Rate limit exceeded
    return { success: false, remaining: 0, resetTime: data.resetTime };
  }

  // Increment count
  data.count++;
  return { success: true, remaining: limit - data.count, resetTime: data.resetTime };
}

/**
 * Get client IP from request headers
 * @param {Request} req - The request object
 * @returns {string} - The client IP address
 */
export function getClientIP(req) {
  // Check various headers that might contain the real IP
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback for Vercel
  const vercelIP = req.headers.get('x-vercel-forwarded-for');
  if (vercelIP) {
    return vercelIP.split(',')[0].trim();
  }

  return 'unknown';
}
