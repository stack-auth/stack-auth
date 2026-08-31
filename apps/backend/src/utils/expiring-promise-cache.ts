type CacheEntry<Value> = {
  expiresAt: number,
  promise: Promise<Value>,
};

export class ExpiringPromiseCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();
  private readonly clock: () => number;
  private readonly maxSize: number | undefined;

  constructor(
    private readonly ttlMs: number,
    options: { clock?: () => number, maxSize?: number } = {},
  ) {
    this.clock = options.clock ?? (() => performance.now());
    this.maxSize = options.maxSize;
  }

  private markRecentlyUsed(key: string, entry: CacheEntry<Value>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  get(key: string, load: () => Promise<Value>): Promise<Value> {
    const now = this.clock();
    const cached = this.entries.get(key);
    if (cached != null && cached.expiresAt > now) {
      this.markRecentlyUsed(key, cached);
      return cached.promise;
    }

    const promise = Promise.resolve().then(load).catch((error: unknown) => {
      if (this.entries.get(key)?.promise === promise) {
        this.entries.delete(key);
      }
      throw error;
    });
    this.entries.set(key, {
      expiresAt: now + this.ttlMs,
      promise,
    });
    if (this.maxSize !== undefined) {
      while (this.entries.size > this.maxSize) {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey === undefined) break;
        this.entries.delete(oldestKey);
      }
    }
    return promise;
  }
}
