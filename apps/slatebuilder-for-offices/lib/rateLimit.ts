import { Redis } from "@upstash/redis";

// Fixed-window rate limiting for the auth surface (login, password reset,
// admin provisioning) — none of those endpoints had any limit before, which
// left them open to unbounded password/secret guessing. Not exact at window
// boundaries, but exactness matters far less here than simply having *a*
// limit at all.

const REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

async function redisRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = new Redis({ url: REDIS_REST_URL as string, token: REDIS_REST_TOKEN as string });
  const rateLimitKey = `ratelimit:${key}`;
  const count = await redis.incr(rateLimitKey);
  if (count === 1) {
    await redis.expire(rateLimitKey, windowSeconds);
  }
  const ttl = await redis.ttl(rateLimitKey);
  const resetAt = Date.now() + Math.max(0, ttl) * 1000;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

// Per-instance only (not shared across serverless instances) when Redis isn't
// configured — a real limit locally/in dev, a weaker best-effort one in a
// multi-instance deployment without Redis.
const globalForRateLimit = globalThis as unknown as {
  __sbRateLimitMemory?: Map<string, { count: number; resetAt: number }>;
};
const memory = globalForRateLimit.__sbRateLimitMemory ?? new Map<string, { count: number; resetAt: number }>();
globalForRateLimit.__sbRateLimitMemory = memory;

function memoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memory.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Applies a fixed-window rate limit keyed by `key` (e.g. `login:ip:1.2.3.4`).
 * Fails open on the limiter's own errors (a Redis blip should not itself lock
 * everyone out) but always enforces the limit when the backing store works.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  if (REDIS_REST_URL && REDIS_REST_TOKEN) {
    try {
      return await redisRateLimit(key, limit, windowSeconds);
    } catch {
      return memoryRateLimit(key, limit, windowSeconds);
    }
  }
  return memoryRateLimit(key, limit, windowSeconds);
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
