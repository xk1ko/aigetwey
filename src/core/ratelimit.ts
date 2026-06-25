/**
 * Per-key request counter on a fixed calendar-minute window. In-memory only —
 * counts reset on restart, which is fine for a 1-minute window. Used to rate-limit
 * gateway keys that opt in via server.key_rpm.
 */
interface Bucket {
  minute: number;
  count: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Record a hit for `key`; return true if it now EXCEEDS `limit` this minute. */
  over(key: string, limit: number, now: number = Date.now()): boolean {
    const minute = Math.floor(now / 60_000);
    const b = this.buckets.get(key);
    if (!b || b.minute !== minute) {
      this.buckets.set(key, { minute, count: 1 });
      return 1 > limit;
    }
    b.count += 1;
    return b.count > limit;
  }
}
