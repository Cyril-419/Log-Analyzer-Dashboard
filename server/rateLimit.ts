/**
 * Fixed-window rate limiter kept in memory: each client gets `limit` requests
 * per window. Good enough for a single server; behind a load balancer you'd
 * move this to Redis or the gateway.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    if (this.limit === 0) return true; // 0 disables the limit
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      this.cleanup(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Forget old clients so the map can't grow forever. */
  private cleanup(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}
