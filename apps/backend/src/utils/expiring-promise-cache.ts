type CacheEntry<Value> = {
  expiresAt: number,
  promise: Promise<Value>,
};

/** Deduplicates concurrent loads and retains successful results for a bounded amount of monotonic time. */
export class ExpiringPromiseCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get(key: string, load: () => Promise<Value>): Promise<Value> {
    const now = this.clock();
    const cached = this.entries.get(key);
    if (cached != null && cached.expiresAt > now) {
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
    return promise;
  }
}
