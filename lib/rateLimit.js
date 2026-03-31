/**
 * Rate limiter with optional Redis backend for serverless environments.
 *
 * When REDIS_URL (or KV_REST_API_URL + KV_REST_API_TOKEN for Vercel KV)
 * is configured, uses Redis for distributed rate limiting.
 * Otherwise falls back to in-memory Map (adequate for single-instance dev).
 */

// ---------------------------------------------------------------------------
// In-memory backend (development / single-instance fallback)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map();
const CLEANUP_INTERVAL = 60 * 1000;
const MAX_ENTRIES = 10000;
let lastCleanup = Date.now();

function cleanupMemory(force = false) {
  const now = Date.now();
  if (!force && rateLimitMap.size < MAX_ENTRIES && now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }
  lastCleanup = now;
  for (const [key, data] of rateLimitMap.entries()) {
    if (data.resetTime <= now) {
      rateLimitMap.delete(key);
    }
  }
  if (rateLimitMap.size > MAX_ENTRIES) {
    const overflow = rateLimitMap.size - MAX_ENTRIES;
    const entries = Array.from(rateLimitMap.entries())
      .sort((a, b) => a[1].resetTime - b[1].resetTime);
    for (let i = 0; i < overflow; i++) {
      rateLimitMap.delete(entries[i][0]);
    }
  }
}

function memoryRateLimit(key, { limit, windowMs }) {
  const forceCleanup = rateLimitMap.size >= MAX_ENTRIES;
  cleanupMemory(forceCleanup);

  const now = Date.now();
  const data = rateLimitMap.get(key);

  if (!data || now > data.resetTime) {
    const resetTime = now + windowMs;
    rateLimitMap.set(key, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime };
  }

  if (data.count >= limit) {
    return { success: false, remaining: 0, resetTime: data.resetTime };
  }

  data.count++;
  return { success: true, remaining: limit - data.count, resetTime: data.resetTime };
}

// ---------------------------------------------------------------------------
// Redis backend (production / multi-instance)
// ---------------------------------------------------------------------------
let redisClient = null;
let redisAvailable = null; // null = not checked, true/false = result

async function getRedisClient() {
  if (redisAvailable === false) return null;

  if (redisClient) return redisClient;

  // Support Vercel KV environment variables
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    redisAvailable = false;
    return null;
  }

  try {
    // Dynamic import to avoid requiring the dependency when not used
    const { createClient } = await import('redis');
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', () => {
      redisAvailable = false;
      redisClient = null;
    });
    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch {
    redisAvailable = false;
    return null;
  }
}

async function redisRateLimit(client, key, { limit, windowMs }) {
  const redisKey = `rl:${key}`;
  const now = Date.now();
  const windowSec = Math.ceil(windowMs / 1000);

  // Use a simple counter with TTL
  const count = await client.incr(redisKey);

  if (count === 1) {
    // First request in this window – set expiry
    await client.expire(redisKey, windowSec);
  }

  const ttl = await client.ttl(redisKey);
  const resetTime = now + ttl * 1000;

  if (count > limit) {
    return { success: false, remaining: 0, resetTime };
  }

  return { success: true, remaining: limit - count, resetTime };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rate limit function – tries Redis first, falls back to in-memory.
 * @param {string} key - Unique identifier (e.g., IP + endpoint)
 * @param {Object} options
 * @param {number} options.limit - Max requests per window
 * @param {number} options.windowMs - Time window in milliseconds
 * @returns {Promise<{ success: boolean, remaining: number, resetTime: number }>}
 */
export async function rateLimit(key, { limit = 5, windowMs = 60 * 1000 } = {}) {
  try {
    const client = await getRedisClient();
    if (client) {
      return await redisRateLimit(client, key, { limit, windowMs });
    }
  } catch {
    // Redis failure – fall through to in-memory
  }

  return memoryRateLimit(key, { limit, windowMs });
}

/**
 * Synchronous in-memory rate limit for code paths that cannot be async.
 * @deprecated Prefer the async `rateLimit` function.
 */
export function rateLimitSync(key, { limit = 5, windowMs = 60 * 1000 } = {}) {
  return memoryRateLimit(key, { limit, windowMs });
}

/**
 * Get client IP from request headers
 * @param {Request} req
 * @returns {string}
 */
export function getClientIP(req) {
  const firstIp = (value) => {
    if (!value || typeof value !== 'string') return null;
    const ip = value.split(',')[0]?.trim();
    return ip || null;
  };

  // 生产环境只信任平台注入的可信来源 IP
  const vercelIP = firstIp(req.headers.get('x-vercel-forwarded-for'));
  if (vercelIP) {
    return vercelIP;
  }

  // 本地开发回退，便于调试
  if (process.env.NODE_ENV !== 'production') {
    const forwardedFor = firstIp(req.headers.get('x-forwarded-for'));
    if (forwardedFor) return forwardedFor;

    const realIP = firstIp(req.headers.get('x-real-ip'));
    if (realIP) return realIP;
  }

  return 'unknown';
}
