/**
 * Small in-process token bucket. It is not a substitute for an edge WAF; it
 * exists so a runaway script or a shared link that leaks cannot hammer the
 * database from one address.
 */
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  const tokens = Math.min(limit, bucket.tokens + refill);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterSeconds: Math.ceil(((1 - tokens) * windowMs) / limit / 1000) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > 5_000) {
    for (const [entryKey, entry] of buckets) {
      if (now - entry.updatedAt > windowMs * 4) buckets.delete(entryKey);
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}
