import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { DatabaseSeq } from "../index.js";
import { PiledriverDatabase, PiledriverObject } from "./index.js";

export type BatchedPiledriverDatabaseOptions = {
  /**
   * The maximum rate at which the wrapper flushes writes to the underlying database: there is at
   * most one underlying `setRootObject`/`deleteRootObject` call per key per `batchIntervalMs`.
   * Defaults to 200 ms.
   */
  batchIntervalMs?: number,
};

/**
 * A `PiledriverDatabase` that adds `flushAll`/`close` for draining pending batched writes and
 * cancelling flush timers so none fire after teardown.
 */
export type BatchedPiledriverDatabase = PiledriverDatabase & {
  /**
   * Flushes all pending batched writes to the underlying database now and awaits their underlying
   * (base) seqs. Re-throws the first error encountered by any underlying flush (fail loud).
   */
  flushAll(): Promise<void>,
  /**
   * Flushes all pending writes and cancels pending flush timers.
   */
  close(): Promise<void>,
};

type Deferred<T> = {
  promise: Promise<T>,
  resolve: (value: T) => void,
  reject: (error: unknown) => void,
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PendingWrite =
  | { op: "set", value: PiledriverObject }
  | { op: "delete" };

// The latest logical state of a key, used to serve reads instantly (whether it is a pending write
// or a value cached from a delegated read). `seq` is the seq getRootObject returns for this state.
type LatestState =
  | { present: true, value: PiledriverObject, seq: DatabaseSeq }
  | { present: false, seq: DatabaseSeq };

type KeyEntry = {
  // A defensive copy of the caller's key. Callers own the ArrayBuffer they pass in and may reuse or
  // mutate it before our timer-driven flush fires, so we snapshot the bytes to keep the key we flush
  // under consistent with the base64 key we index by.
  key: ArrayBuffer,
  latest: LatestState | undefined,
  // The un-flushed write for this key (null when everything has been flushed), plus the deferred
  // that all synthetic seqs minted for the current batch window point to. It resolves to the base
  // seq returned by the coalesced flush that includes those writes.
  pending: PendingWrite | null,
  pendingDeferred: Deferred<DatabaseSeq> | null,
  flushTimer: ReturnType<typeof setTimeout> | null,
  // The tail of this key's flush chain, so flushes for the same key never overlap or reorder
  // (latest-write-wins would be violated if an older slow flush finished after a newer one).
  inFlight: Promise<void>,
};

/**
 * Wraps a `PiledriverDatabase` and batches root writes: for each key there is at most one
 * underlying `setRootObject`/`deleteRootObject` call per `batchIntervalMs`, coalescing to the
 * latest value (latest-write-wins; a delete after a set flushes as a delete).
 *
 * Reads are served from an in-memory "latest" state, so `setRootObject`/`deleteRootObject` return
 * immediately without awaiting the underlying write, and a subsequent `getRootObject` sees the
 * pending value right away. This is safe because Piledriver objects are immutable, so holding and
 * handing out references across reads without copying does not risk exposing mutations.
 *
 * ## Seq semantics
 * Because reads are served from in-memory state, a write's seq is already "available" to this
 * client before it is durable. We therefore mint synthetic seqs for batched writes and keep a
 * registry mapping each synthetic seq to a promise that resolves to the real base seq once the
 * coalesced flush that includes the write completes:
 * - `waitUntilAvailable` resolves immediately for synthetic seqs (the value is already visible).
 * - `waitUntilDurable`/`waitUntilReplicated` await the flush, then delegate to the base with the
 *   real base seq.
 *
 * Seqs returned by `getRootObject` when we delegate to the base are real base seqs, not synthetic.
 * We distinguish the two by identity via the synthetic-seq registry: a seq present in the registry
 * is synthetic (resolve it to a base seq before delegating), otherwise it is a base pass-through
 * seq (delegate to the base directly). This keeps the common all-base `combineSeqs` path free of
 * synthetic-seq allocation.
 */
export function declareBatchedPiledriverDatabase(basePiledriverDb: PiledriverDatabase, options: BatchedPiledriverDatabaseOptions = {}): BatchedPiledriverDatabase {
  const batchIntervalMs = options.batchIntervalMs ?? 200;
  if (!Number.isFinite(batchIntervalMs) || batchIntervalMs < 0) throw new Error("batchIntervalMs must be a non-negative finite number");

  const entries = new Map<string, KeyEntry>();
  // Maps each synthetic seq (a fresh array object) to a promise resolving to the real base seq the
  // coalesced flush produces. A WeakMap keyed by the seq object lets synthetic seqs be collected
  // once no caller holds them, and doubles as the "is this seq synthetic?" test.
  const syntheticSeqRegistry = new WeakMap<object, Promise<DatabaseSeq>>();
  // The first error thrown by any underlying flush, remembered so it is surfaced (fail loud) on the
  // next flushAll/close rather than silently swallowed.
  let flushError: unknown = undefined;

  const keyBase64Of = (key: ArrayBuffer) => encodeBase64(new Uint8Array(key));

  const getOrCreateEntry = (keyBase64: string, key: ArrayBuffer): KeyEntry => {
    let entry = entries.get(keyBase64);
    if (entry === undefined) {
      // slice(0) copies the bytes so a later caller-side mutation of `key` can't change what we flush.
      entry = { key: key.slice(0), latest: undefined, pending: null, pendingDeferred: null, flushTimer: null, inFlight: Promise.resolve() };
      entries.set(keyBase64, entry);
    }
    return entry;
  };

  const mintSyntheticSeq = (baseSeqPromise: Promise<DatabaseSeq>): DatabaseSeq => {
    // Branded seqs can only be constructed via an assertion; the low-level implementations mint
    // their seqs the same way (see in-memory.ts / instant-availability.ts).
    const seq = ["batched-piledriver-synthetic-seq", crypto.randomUUID()] as unknown as DatabaseSeq;
    syntheticSeqRegistry.set(seq, baseSeqPromise);
    return seq;
  };

  // Resolves a seq to a promise of a real base seq: synthetic seqs await their flush, base
  // pass-through seqs resolve to themselves. Never awaits here so the fast (sync) path stays cheap.
  const baseSeqPromiseOf = (seq: DatabaseSeq): Promise<DatabaseSeq> => syntheticSeqRegistry.get(seq) ?? Promise.resolve(seq);

  const performFlush = async (entry: KeyEntry, pending: PendingWrite, deferred: Deferred<DatabaseSeq>, previous: Promise<void>): Promise<void> => {
    // Preserve per-key ordering; `previous` never rejects (this function records errors instead of
    // throwing), but guard defensively so a future change can't turn it into an unhandled rejection.
    await previous.catch(() => {});
    try {
      const { seq } = pending.op === "set"
        ? await basePiledriverDb.setRootObject(entry.key, pending.value)
        : await basePiledriverDb.deleteRootObject(entry.key);
      deferred.resolve(seq);
    } catch (error) {
      flushError ??= error;
      deferred.reject(error);
      // Re-buffer the failed write for retry unless a newer write has already superseded it, so a
      // transient backend error doesn't silently drop a value that `latest` still serves. The next
      // flushAll/close (or a subsequent write's timer) retries it. Callers that awaited this batch's
      // durability still saw the rejection above (fail loud); the retry uses a fresh deferred.
      if (entry.pending === null) {
        entry.pending = pending;
        if (entry.pendingDeferred === null) {
          const retryDeferred = createDeferred<DatabaseSeq>();
          retryDeferred.promise.catch(() => {});
          entry.pendingDeferred = retryDeferred;
        }
      }
    }
  };

  // Moves the entry's currently-buffered write into an in-flight flush. Safe to call from the timer
  // or from flushAll; a no-op when there is nothing pending.
  const startFlush = (entry: KeyEntry) => {
    if (entry.flushTimer !== null) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
    if (entry.pending === null || entry.pendingDeferred === null) return;
    const pending = entry.pending;
    const deferred = entry.pendingDeferred;
    entry.pending = null;
    entry.pendingDeferred = null;
    entry.inFlight = performFlush(entry, pending, deferred, entry.inFlight);
  };

  const scheduleWrite = (key: ArrayBuffer, write: PendingWrite): DatabaseSeq => {
    const keyBase64 = keyBase64Of(key);
    const entry = getOrCreateEntry(keyBase64, key);
    entry.pending = write;
    if (entry.pendingDeferred === null) {
      const deferred = createDeferred<DatabaseSeq>();
      // Guard against an unhandled rejection when no caller ever awaits this write's durability; the
      // error is still remembered in flushError and surfaced by flushAll/close (fail loud).
      deferred.promise.catch(() => {});
      entry.pendingDeferred = deferred;
    }
    const seq = mintSyntheticSeq(entry.pendingDeferred.promise);
    entry.latest = write.op === "set" ? { present: true, value: write.value, seq } : { present: false, seq };
    // Fixed-window throttle: the first write in a window schedules the single flush; later writes in
    // the same window only update `latest`/`pending`, guaranteeing at most one flush per interval.
    if (entry.flushTimer === null) {
      entry.flushTimer = setTimeout(() => startFlush(entry), batchIntervalMs);
    }
    return seq;
  };

  const flushAll = async (): Promise<void> => {
    const settled: Promise<void>[] = [];
    for (const entry of entries.values()) {
      startFlush(entry);
      settled.push(entry.inFlight.catch(() => {}));
    }
    await Promise.all(settled);
    // Surface (once) the first error any flush hit, then clear it so a later flushAll after a
    // successful retry doesn't keep throwing a stale error. Individual waiters already saw their own
    // rejection via the per-write deferred, so this is only a backstop for un-awaited writes.
    if (flushError !== undefined) {
      const error = flushError;
      flushError = undefined;
      throw error;
    }
  };

  const result: BatchedPiledriverDatabase = {
    getDebugInfo() {
      return {
        backend: "batched-piledriver",
        constructorArguments: { basePiledriverDb, options },
        basePiledriverDb,
        batchIntervalMs,
        pendingKeys: [...entries.entries()].filter(([, entry]) => entry.pending !== null).map(([keyBase64]) => keyBase64),
        hasFlushError: flushError !== undefined,
      };
    },
    async getRootObject(key): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> {
      const keyBase64 = keyBase64Of(key);
      const entry = entries.get(keyBase64);
      if (entry?.latest !== undefined) {
        if (entry.latest.present) return { object: entry.latest.value, seq: entry.latest.seq };
        // Mirror the base's not-found behavior exactly; bulldozer matches on this message.
        throw new Error("Root object not found");
      }
      const { object, seq } = await basePiledriverDb.getRootObject(key);
      // Cache the read result so subsequent reads are instant. Only cache when nothing is pending or
      // already cached, to avoid clobbering a newer in-memory state written concurrently.
      const cacheEntry = getOrCreateEntry(keyBase64, key);
      if (cacheEntry.latest === undefined && cacheEntry.pending === null) {
        cacheEntry.latest = { present: true, value: object, seq };
      }
      return { object, seq };
    },
    async setRootObject(key, value): Promise<{ seq: DatabaseSeq }> {
      return { seq: scheduleWrite(key, { op: "set", value }) };
    },
    async deleteRootObject(key): Promise<{ seq: DatabaseSeq }> {
      return { seq: scheduleWrite(key, { op: "delete" }) };
    },
    async waitUntilAvailable(seq): Promise<void> {
      // Synthetic writes are already visible to reads from this client; base pass-through seqs
      // delegate (they come from getRootObject, which read them, so this resolves immediately).
      if (syntheticSeqRegistry.has(seq)) return;
      await basePiledriverDb.waitUntilAvailable(seq);
    },
    async waitUntilDurable(seq): Promise<void> {
      await basePiledriverDb.waitUntilDurable(await baseSeqPromiseOf(seq));
    },
    async waitUntilReplicated(seq): Promise<void> {
      await basePiledriverDb.waitUntilReplicated(await baseSeqPromiseOf(seq));
    },
    combineSeqs(...seqs): DatabaseSeq {
      // Fast path: when no seq is synthetic, delegate directly so we don't allocate a synthetic
      // combined seq (the base already deduplicates and drops initial seqs).
      if (!seqs.some(seq => syntheticSeqRegistry.has(seq))) return basePiledriverDb.combineSeqs(...seqs);
      const componentPromises = seqs.map(baseSeqPromiseOf);
      const combinedBaseSeqPromise = (async () => basePiledriverDb.combineSeqs(...await Promise.all(componentPromises)))();
      combinedBaseSeqPromise.catch(() => {});
      return mintSyntheticSeq(combinedBaseSeqPromise);
    },
    async flushAll(): Promise<void> {
      await flushAll();
    },
    async close(): Promise<void> {
      // flushAll drains pending writes and clears every pending flush timer, so none can fire after
      // teardown. The base PiledriverDatabase has no close() of its own to delegate to.
      await flushAll();
    },
    initialSeq: basePiledriverDb.initialSeq,
  };

  if (basePiledriverDb.debugSnapshot !== undefined) {
    const baseDebugSnapshot = basePiledriverDb.debugSnapshot.bind(basePiledriverDb);
    result.debugSnapshot = async () => {
      await flushAll();
      return await baseDebugSnapshot();
    };
  }
  if (basePiledriverDb.debugLowLevelSnapshot !== undefined) {
    const baseDebugLowLevelSnapshot = basePiledriverDb.debugLowLevelSnapshot.bind(basePiledriverDb);
    result.debugLowLevelSnapshot = async () => {
      await flushAll();
      return await baseDebugLowLevelSnapshot();
    };
  }

  return result;
}
