/** A fixed-window counter per key, such as a client address. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly maxKeys = 50_000,
  ) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("limit must be a positive integer");
  }

  /** Count one request. False when the key is over its limit for this window. */
  allow(key: string, now: number): boolean {
    const current = this.windows.get(key);
    if (current === undefined || now - current.start >= this.windowSeconds) {
      if (this.windows.size >= this.maxKeys) this.prune(now);
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowSeconds) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
