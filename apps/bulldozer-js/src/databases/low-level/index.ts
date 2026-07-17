import { Database, DatabaseSeq } from "../index.js";

/**
 * A low-level database that can create KV stores and KV dumps.
 *
 * Note that each KV store and KV dump is independent of the others; it may get ahead or fall behind in terms of seq
 * replication. It is therefore crucial to use `requiresSeq` correctly when doing a modification that relies on another
 * modification. It is *not* sufficient to just use `waitUntilAvailable` or `waitUntilDurable` between modifications if
 * they happen on different stores/dumps, as these only guarantee availability on the current client. It would
 * theoretically be enough to use `waitUntilReplicated` instead of `requiresSeq`, but this would incur a higher latency.
 */
export type LowLevelDatabase = Database & {
  declareKvStore(id: string): LowLevelKvStore;
  declareKvDump(id: string): LowLevelKvDump;
  debugSnapshot?(): Promise<LowLevelDatabaseDebugSnapshot>;
};

export type LowLevelDatabaseDebugEntry = {
  keyBase64: string,
  keyUtf8: string | null,
  keyHex: string,
  valueBase64: string,
  valueUtf8: string | null,
  valueByteLength: number,
};

export type LowLevelDatabaseDebugSnapshot = {
  stores: Record<string, LowLevelDatabaseDebugEntry[]>,
  dumps: Record<string, LowLevelDatabaseDebugEntry[]>,
};

/**
 * A simple KV store.
 *
 * Keys must be <= 64 bytes and value must be <= 2 GB. These restrictions should be strictly enforced by the
 * implementation.
 *
 * Note that durability (or replication) of a modifying function is only guaranteed after `waitUntilDurable(seq)` (or
 * `waitUntilReplicated(seq)` for either the returned `seq` or a `seq` that's greater (determined using `maxSeq`).
 */
export type LowLevelKvStore = {
  get(key: ArrayBuffer): Promise<{ buffer: ArrayBuffer | null, seq: DatabaseSeq }>,
  setAll(entries: Array<{ key: ArrayBuffer, value: ArrayBuffer }>, options?: { requiresSeq?: DatabaseSeq }): Promise<{ seq: DatabaseSeq }>,
  deleteAll(keys: ArrayBuffer[]): Promise<{ seq: DatabaseSeq }>,

  compareAndSet(key: ArrayBuffer, compare: ArrayBuffer, value: ArrayBuffer, options?: { requiresSeq?: DatabaseSeq }): Promise<{ wasSet: true, seq: DatabaseSeq } | { wasSet: false, seq: null }>,
  debugEntries?(): Promise<LowLevelDatabaseDebugEntry[]>,
}

/**
 * A KV dump. It is like a KV store, but all objects are immutable once created; therefore, instead of exposing a
 * `setAll` function, it exposes an `insertAll` function.
 *
 * If values are never modified, then a KV dump can be significantly more efficient than a KV store, especially in a
 * distributed setting.
 *
 * A dump *can* delete entries (via `deleteAll`) — immutability only forbids *changing* a value in place, not removing
 * it once nothing references it anymore. This is what makes garbage collection possible (see `piledriver/gc.ts`).
 * `setAll` and `compareAndSet` remain omitted: values are content that the dump assigns keys to, so callers must never
 * choose keys or overwrite existing entries.
 *
 * Keys must be <= 64 bytes and value must be <= 2 GB. These restrictions should be strictly enforced by the
 * implementation.
 *
 * Note that durability of a modifying function is only guaranteed after `waitUntilDurable(seq)` for either the returned
 * `seq` or a `seq` that's greater (determined using `maxSeq`).
 */
export type LowLevelKvDump = Omit<LowLevelKvStore, "setAll" | "compareAndSet"> & {
  /**
   * Inserts the values and returns their keys in the same order.
   *
   * How the keys are assigned is implementation-dependent, although they must always be unique within a single KV dump.
   * Implementations are encouraged to use keys that make the insert operation as performant as possible.
   */
  insertAll(values: ArrayBuffer[], options?: { requiresSeq?: DatabaseSeq }): Promise<{ keys: ArrayBuffer[], seq: DatabaseSeq }>,
}
