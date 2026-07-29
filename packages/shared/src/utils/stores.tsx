import { ReadWriteLock } from "./locks";
import { ReactPromise, pending, rejected, resolved } from "./promises";
import { AsyncResult, Result } from "./results";
import { generateUuid } from "./uuids";

export type ReadonlyStore<T> = {
  get(): T,
  onChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void },
  onceChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void },
};

export type AsyncStoreStateChangeCallback<T> = (args: { state: AsyncResult<T>, oldState: AsyncResult<T>, lastOkValue: T | undefined }) => void;

export type ReadonlyAsyncStore<T> = {
  isAvailable(): boolean,
  get(): AsyncResult<T, unknown, void>,
  getOrWait(): ReactPromise<T>,
  onChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void },
  onceChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void },
  onStateChange(callback: AsyncStoreStateChangeCallback<T>): { unsubscribe: () => void },
  onceStateChange(callback: AsyncStoreStateChangeCallback<T>): { unsubscribe: () => void },
};

export class Store<T> implements ReadonlyStore<T> {
  private readonly _callbacks: Map<string, ((value: T, oldValue: T | undefined) => void)> = new Map();

  constructor(
    private _value: T
  ) {}

  get(): T {
    return this._value;
  }

  set(value: T): void {
    const oldValue = this._value;
    this._value = value;
    this._callbacks.forEach((callback) => callback(value, oldValue));
  }

  update(updater: (value: T) => T): T {
    const value = updater(this._value);
    this.set(value);
    return value;
  }

  onChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void } {
    const uuid = generateUuid();
    this._callbacks.set(uuid, callback);
    return {
      unsubscribe: () => {
        this._callbacks.delete(uuid);
      },
    };
  }

  onceChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void } {
    const { unsubscribe } = this.onChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }
}

export const storeLock = new ReadWriteLock();


export class AsyncStore<T> implements ReadonlyAsyncStore<T> {
  private _isAvailable: boolean;
  private _mostRecentOkValue: T | undefined = undefined;

  private _isRejected = false;
  private _rejectionError: unknown;
  private readonly _waitingRejectFunctions = new Map<string, ((error: unknown) => void)>();

  private readonly _callbacks: Map<string, AsyncStoreStateChangeCallback<T>> = new Map();

  private _updateCounter = 0;
  private _lastSuccessfulUpdate = -1;

  constructor(...args: [] | [T]) {
    if (args.length === 0) {
      this._isAvailable = false;
    } else {
      this._isAvailable = true;
      this._mostRecentOkValue = args[0];
    }
  }

  isAvailable(): boolean {
    return this._isAvailable;
  }

  isRejected(): boolean {
    return this._isRejected;
  }

  get() {
    if (this.isRejected()) {
      return AsyncResult.error(this._rejectionError);
    } else if (this.isAvailable()) {
      return AsyncResult.ok(this._mostRecentOkValue as T);
    } else {
      return AsyncResult.pending();
    }
  }

  getOrWait(): ReactPromise<T> {
    const uuid = generateUuid();
    if (this.isRejected()) {
      return rejected(this._rejectionError);
    } else if (this.isAvailable()) {
      return resolved(this._mostRecentOkValue as T);
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.onceChange((value) => {
        resolve(value);
      });
      this._waitingRejectFunctions.set(uuid, reject);
    });
    const withFinally = promise.finally(() => {
      this._waitingRejectFunctions.delete(uuid);
    });
    return pending(withFinally);
  }

  _setIfLatest(result: Result<T>, curCounter: number) {
    const oldState = this.get();
    const oldValue = this._mostRecentOkValue;
    if (curCounter > this._lastSuccessfulUpdate) {
      switch (result.status) {
        case "ok": {
          if (!this._isAvailable || this._isRejected || this._mostRecentOkValue !== result.data) {
            this._lastSuccessfulUpdate = curCounter;
            this._isAvailable = true;
            this._isRejected = false;
            this._mostRecentOkValue = result.data;
            this._rejectionError = undefined;
            this._callbacks.forEach((callback) => callback({
              state: this.get(),
              oldState,
              lastOkValue: oldValue,
            }));
            return true;
          }
          return false;
        }
        case "error": {
          this._lastSuccessfulUpdate = curCounter;
          this._isAvailable = false;
          this._isRejected = true;
          this._rejectionError = result.error;
          this._waitingRejectFunctions.forEach((reject) => reject(result.error));
          this._callbacks.forEach((callback) => callback({
            state: this.get(),
            oldState,
            lastOkValue: oldValue,
          }));
          return true;
        }
      }
    }
    return false;
  }

  set(value: T): void {
    this._setIfLatest(Result.ok(value), ++this._updateCounter);
  }

  update(updater: (value: T | undefined) => T): T {
    const value = updater(this._mostRecentOkValue);
    this.set(value);
    return value;
  }

  async setAsync(promise: Promise<T>): Promise<boolean> {
    // setAsync coordinates with write-locked mutations on `storeLock` (currently only the SDK's
    // sign-out flow, which revokes the session server-side, clears the token store, and redirects
    // under the write lock). The invariant we must uphold: a value that was fetched against
    // pre-mutation state (eg. user data fetched with a session that has since been signed out)
    // must NEVER be committed to the store after the mutation ran, and no store commit (which
    // synchronously fires onStateChange callbacks, potentially re-rendering UI) may interleave
    // with the write-locked critical section itself.
    //
    // Historically (PR #374, "sign out lock") this was implemented by holding the READ lock for
    // the entire duration of the awaited promise. That upheld the invariant, but it also meant a
    // slow fetch (a network call with retries) starved any writer: sign-out could be blocked for
    // tens of seconds by unrelated background cache fetches. Note that holding the lock across
    // the await never prevented fetches from *starting* during a mutation anyway — callers (see
    // AsyncValueCache._refetch) create the fetch promise before calling setAsync — so the lock
    // was only ever about ordering commits, not about preventing concurrent I/O.
    //
    // Instead, we now await the promise WITHOUT holding any lock, and only take the read lock for
    // the commit itself (which does no I/O). To uphold the invariant, we snapshot the lock's
    // write generation before awaiting: if a writer acquired the lock while we were waiting, the
    // fetched value is based on pre-mutation state, so we discard it instead of committing.
    // Discarding is safe for callers awaiting the fetched value itself, because they get it from
    // the original promise (again, see AsyncValueCache._refetch), not from the store; only the
    // cached/observable state update is skipped. A setAsync that starts while the writer is
    // already active snapshots the writer's own generation and is therefore still allowed to
    // commit afterwards — this intentionally preserves the pre-existing behavior where refreshes
    // triggered from within the mutation (eg. cache invalidation during sign-out committing the
    // signed-out state) still go through.
    //
    // The update counter is taken at call time (not at commit time) so that a synchronous set()
    // that happens while the fetch is in flight wins over the older fetch result via the
    // _setIfLatest counter check, matching the pre-lock semantics of this method.
    const curCounter = ++this._updateCounter;
    const writeGenerationAtStart = storeLock.getWriteGeneration();
    const result = await Result.fromPromise(promise);
    return await storeLock.withReadLock(async () => {
      // Comparing generations under the read lock is reliable: no writer can be active while we
      // hold it, so the generation cannot change between this check and the commit below.
      if (storeLock.getWriteGeneration() !== writeGenerationAtStart) {
        return false;
      }
      return this._setIfLatest(result, curCounter);
    });
  }

  setUnavailable(): void {
    this._lastSuccessfulUpdate = ++this._updateCounter;
    this._mostRecentOkValue = undefined;
    this._isAvailable = false;
    this._isRejected = false;
    this._rejectionError = undefined;
  }

  setRejected(error: unknown): void {
    this._setIfLatest(Result.error(error), ++this._updateCounter);
  }

  map<U>(mapper: (value: T) => U): AsyncStore<U> {
    const store = new AsyncStore<U>();
    this.onChange((value) => {
      store.set(mapper(value));
    });
    return store;
  }

  onChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void } {
    return this.onStateChange(({ state, lastOkValue }) => {
      if (state.status === "ok") {
        callback(state.data, lastOkValue);
      }
    });
  }

  onStateChange(callback: AsyncStoreStateChangeCallback<T>): { unsubscribe: () => void } {
    const uuid = generateUuid();
    this._callbacks.set(uuid, callback);
    return {
      unsubscribe: () => {
        this._callbacks.delete(uuid);
      },
    };
  }

  onceChange(callback: (value: T, oldValue: T | undefined) => void): { unsubscribe: () => void } {
    const { unsubscribe } = this.onChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }

  onceStateChange(callback: AsyncStoreStateChangeCallback<T>): { unsubscribe: () => void } {
    const { unsubscribe } = this.onStateChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }
}

// Concurrency tests for setAsync <-> storeLock coordination. These pin down the invariants that
// the SDK's sign-out flow relies on (see the comment inside setAsync); they intentionally use the
// global storeLock singleton, just like production code does. The tests in this file run
// sequentially, so bumping the global write generation here cannot interfere with other tests.
import.meta.vitest?.test("AsyncStore.setAsync commits normally when no write-locked mutation intervenes", async ({ expect }) => {
  const store = new AsyncStore<string>();
  expect(store.get().status).toBe("pending");
  expect(await store.setAsync(Promise.resolve("value"))).toBe(true);
  expect(store.get()).toEqual({ status: "ok", data: "value" });

  // a second commit with a newer value also goes through
  expect(await store.setAsync(Promise.resolve("value2"))).toBe(true);
  expect(store.get()).toEqual({ status: "ok", data: "value2" });
});

import.meta.vitest?.test("AsyncStore.setAsync propagates fetch rejections as rejected state", async ({ expect }) => {
  const store = new AsyncStore<string>();
  const error = new Error("fetch failed");
  expect(await store.setAsync(Promise.reject(error))).toBe(true);
  expect(store.get()).toEqual({ status: "error", error });
});

import.meta.vitest?.test("AsyncStore.setAsync does not block write-lock acquisition while the fetch is in flight", async ({ expect }) => {
  const store = new AsyncStore<string>();
  let resolveFetch!: (value: string) => void;
  const setAsyncPromise = store.setAsync(new Promise<string>((resolve) => {
    resolveFetch = resolve;
  }));

  // Before the fix, setAsync held a global read lock for the whole duration of the fetch, so this
  // write-lock acquisition would starve until the fetch resolved (in production: until a network
  // call with retries drained). Now it must complete while the fetch is still pending. We guard
  // with a timeout so a regression fails the test instead of hanging it forever.
  const writerPromise = storeLock.withWriteLock(async () => "writer-ran");
  const timeout = new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 1000));
  expect(await Promise.race([writerPromise, timeout])).toBe("writer-ran");

  resolveFetch("value");
  // the writer that ran above counts as a mutation, so this pre-writer fetch must now be discarded
  expect(await setAsyncPromise).toBe(false);
});

import.meta.vitest?.test("AsyncStore.setAsync discards a fetch that started before a write-locked mutation", async ({ expect }) => {
  // Case 1: fetch resolves AFTER the mutation completed
  const store1 = new AsyncStore<string>();
  let resolveFetch1!: (value: string) => void;
  const setAsyncPromise1 = store1.setAsync(new Promise<string>((resolve) => {
    resolveFetch1 = resolve;
  }));
  await storeLock.withWriteLock(async () => {
    // simulates sign-out: session revoked, token store cleared
  });
  resolveFetch1("stale-value");
  expect(await setAsyncPromise1).toBe(false);
  // the stale value must never become observable state
  expect(store1.get().status).toBe("pending");

  // Case 2: fetch resolves WHILE the mutation is still active; the commit must wait for the
  // writer to finish (no interleaving with the critical section) and then be discarded.
  const store2 = new AsyncStore<string>();
  let resolveFetch2!: (value: string) => void;
  const setAsyncPromise2 = store2.setAsync(new Promise<string>((resolve) => {
    resolveFetch2 = resolve;
  }));
  await storeLock.withWriteLock(async () => {
    resolveFetch2("stale-value");
    // yield a few microtask/macrotask ticks so the commit path would have had a chance to run if
    // it (incorrectly) didn't wait for the write lock
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(store2.get().status).toBe("pending");
  });
  expect(await setAsyncPromise2).toBe(false);
  expect(store2.get().status).toBe("pending");
});

import.meta.vitest?.test("AsyncStore.setAsync started during a write-locked mutation may still commit afterwards", async ({ expect }) => {
  // Refreshes triggered from within the mutation itself (eg. cache invalidation during sign-out
  // committing the signed-out state) share the writer's generation and must still commit.
  const store = new AsyncStore<string>();
  let setAsyncPromise!: Promise<boolean>;
  await storeLock.withWriteLock(async () => {
    setAsyncPromise = store.setAsync(Promise.resolve("post-mutation-value"));
  });
  expect(await setAsyncPromise).toBe(true);
  expect(store.get()).toEqual({ status: "ok", data: "post-mutation-value" });
});

import.meta.vitest?.test("AsyncStore.set during an in-flight setAsync wins over the older fetch result", async ({ expect }) => {
  // The update counter is taken when setAsync is CALLED, so a later synchronous set() must beat
  // the fetch result even though the fetch commits later in wall-clock time.
  const store = new AsyncStore<string>();
  let resolveFetch!: (value: string) => void;
  const setAsyncPromise = store.setAsync(new Promise<string>((resolve) => {
    resolveFetch = resolve;
  }));
  store.set("newer-sync-value");
  resolveFetch("older-fetched-value");
  expect(await setAsyncPromise).toBe(false);
  expect(store.get()).toEqual({ status: "ok", data: "newer-sync-value" });
});
