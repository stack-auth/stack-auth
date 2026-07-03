import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { traceSpan } from "../../../otel.js";
import { DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelKvDump, LowLevelKvStore } from "../index.js";

function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const aUint8Array = new Uint8Array(a);
  const bUint8Array = new Uint8Array(b);
  for (let i = 0; i < aUint8Array.length; i++) {
    if (aUint8Array[i] !== bUint8Array[i]) return false;
  }
  return true;
}

type InstantAvailabilitySeq = readonly [dbId: string, seqId: string] & { __brand: "hexclave-low-level-kv-store-seq" };
type SeqRecord = {
  underlyingSeq: Promise<DatabaseSeq>,
  underlyingAvailable: Promise<void>,
  isSettled: boolean,
};
type CachedValue = {
  buffer: ArrayBuffer | null,
  seq: DatabaseSeq,
};
export type InstantAvailabilityLowLevelDatabaseDebugSnapshot = {
  createdSeqRecords: number,
  pendingSeqRecords: number,
  underlyingAvailableSeqRecords: number,
  cachedValues: number,
};
export type InstantAvailabilityLowLevelDatabase = LowLevelDatabase & {
  debugInstantAvailability(): InstantAvailabilityLowLevelDatabaseDebugSnapshot,
  waitUntilUnderlyingAvailable(seq: DatabaseSeq): Promise<void>,
};
export type InstantAvailabilityLowLevelDatabaseOptions = {
  dbId?: string,
  maxPendingSeqRecords?: number,
};

const cloneArrayBuffer = (value: ArrayBuffer) => value.slice(0);

export function declareInstantAvailabilityLowLevelDatabase(wrapped: LowLevelDatabase, options: InstantAvailabilityLowLevelDatabaseOptions = {}): InstantAvailabilityLowLevelDatabase {
  const dbId = options.dbId ?? `instant-availability-${crypto.randomUUID()}`;
  const maxPendingSeqRecords = options.maxPendingSeqRecords ?? 20_000;
  if (!Number.isFinite(maxPendingSeqRecords) || maxPendingSeqRecords <= 0) throw new Error("maxPendingSeqRecords must be a positive finite number");
  const initialSeqId = "initial";
  const initialSeq = [dbId, initialSeqId] as unknown as InstantAvailabilitySeq;
  const seqRecords = new WeakMap<object, SeqRecord>();
  let createdSeqRecords = 1;
  let underlyingAvailableSeqRecords = 1;
  const pendingSeqRecords = new Set<SeqRecord>();
  let currentWriteGateOperation: Promise<void> = Promise.resolve();
  let pendingSeqRecordsChangedResolve: () => void;
  let pendingSeqRecordsChanged = new Promise<void>(resolve => {
    pendingSeqRecordsChangedResolve = resolve;
  });
  seqRecords.set(initialSeq, {
    underlyingSeq: Promise.resolve(wrapped.initialSeq),
    underlyingAvailable: Promise.resolve(),
    isSettled: true,
  });
  const cacheMaps = new Set<Map<string, CachedValue>>();

  const toSeq = (seqId: string) => [dbId, seqId] as unknown as InstantAvailabilitySeq;
  const getSeqId = (seq: DatabaseSeq | undefined) => {
    if (seq === undefined) return initialSeqId;
    if (seq[0] !== dbId || typeof seq[1] !== "string") throw new Error("Instant-availability sequence does not belong to this database");
    return seq[1];
  };
  const getSeqRecord = (seq: DatabaseSeq | undefined) => {
    const seqObject = seq ?? initialSeq;
    getSeqId(seqObject);
    const record = seqRecords.get(seqObject);
    if (record === undefined) throw new Error("Unknown instant-availability sequence");
    return record;
  };
  const getUnderlyingSeq = async (seq: DatabaseSeq | undefined) => await getSeqRecord(seq).underlyingSeq;
  const notifyPendingSeqRecordsChanged = () => {
    pendingSeqRecordsChangedResolve();
    pendingSeqRecordsChanged = new Promise<void>(resolve => {
      pendingSeqRecordsChangedResolve = resolve;
    });
  };
  const waitForPendingSeqRecordBudget = async () => {
    await traceSpan({ description: "bulldozer-js.low-level.instant.waitForPendingSeqRecordBudget", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => {
      while (pendingSeqRecords.size >= maxPendingSeqRecords) {
        await pendingSeqRecordsChanged;
      }
    });
  };
  const withWriteGate = async <T>(operation: () => Promise<T>): Promise<T> => {
    return await traceSpan({ description: "bulldozer-js.low-level.instant.withWriteGate", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => {
      const previousOperation = currentWriteGateOperation;
      let releaseCurrentOperation: () => void;
      currentWriteGateOperation = new Promise<void>(resolve => {
        releaseCurrentOperation = resolve;
      });
      await previousOperation.catch(() => {});
      try {
        await waitForPendingSeqRecordBudget();
        return await operation();
      } finally {
        releaseCurrentOperation!();
      }
    });
  };
  const createSeq = (underlyingSeq: Promise<DatabaseSeq>) => {
    const seq = toSeq(crypto.randomUUID());
    underlyingSeq.catch(() => {});
    const underlyingAvailable = traceSpan({ description: "bulldozer-js.low-level.instant.underlyingAvailable", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => {
      const resolvedUnderlyingSeq = await underlyingSeq;
      await wrapped.waitUntilAvailable(resolvedUnderlyingSeq);
    });
    // This is the "instant availability" trade-off: callers (e.g. write routes)
    // return as soon as the value is in this in-memory cache, NOT after it lands
    // in the wrapped (on-disk) store. If that background commit fails, the data
    // never reached disk even though the caller saw success — so we must surface
    // it to Sentry rather than swallowing it, so it can be detected and the row
    // reconciled. We deliberately don't block any caller on this (no fsync on the
    // hot path); other awaiters of `underlyingAvailable` handle the rejection
    // themselves, this handler exists purely to report + avoid an unhandled
    // rejection.
    underlyingAvailable.catch(error => captureError("bulldozer-js:instant-availability-durable-commit", error));
    const record = { underlyingSeq, underlyingAvailable, isSettled: false };
    createdSeqRecords++;
    pendingSeqRecords.add(record);
    underlyingAvailable.finally(() => {
      record.isSettled = true;
      underlyingAvailableSeqRecords++;
      pendingSeqRecords.delete(record);
      notifyPendingSeqRecordsChanged();
    }).catch(() => {});
    seqRecords.set(seq, record);
    return seq;
  };
  const declareStoreOrDump = (wrappedStore: LowLevelKvStore & LowLevelKvDump): LowLevelKvStore & LowLevelKvDump => {
    const cachedValues = new Map<string, CachedValue>();
    cacheMaps.add(cachedValues);
    const attributes = { "bulldozer.low_level.backend": "instant-availability" };
    const cacheKey = (key: ArrayBuffer) => encodeBase64(new Uint8Array(key));
    const setCachedValue = (key: ArrayBuffer, value: ArrayBuffer | null, seq: DatabaseSeq) => {
      cachedValues.set(cacheKey(key), { buffer: value === null ? null : cloneArrayBuffer(value), seq });
    };
    const evictAfterWrappedAvailability = (keys: ArrayBuffer[], seq: DatabaseSeq) => {
      getSeqRecord(seq).underlyingAvailable
        .then(() => {
          for (const key of keys) {
            const keyString = cacheKey(key);
            if (cachedValues.get(keyString)?.seq === seq) cachedValues.delete(keyString);
          }
        })
        .catch(() => {});
    };

    const setAllLocked = (entries: Array<{ key: ArrayBuffer, value: ArrayBuffer }>, setOptions?: { requiresSeq?: DatabaseSeq }): { seq: DatabaseSeq } => {
      const entriesForWrapped = entries.map(({ key, value }) => ({ key: cloneArrayBuffer(key), value: cloneArrayBuffer(value) }));
      const underlyingSeq = (async () => {
        const requiresSeq = await getUnderlyingSeq(setOptions?.requiresSeq);
        const { seq } = await wrappedStore.setAll(entriesForWrapped, { requiresSeq });
        return seq;
      })();
      const seq = createSeq(underlyingSeq);
      for (const { key, value } of entries) setCachedValue(key, value, seq);
      evictAfterWrappedAvailability(entries.map(({ key }) => key), seq);
      return { seq };
    };

    const result: LowLevelKvStore & LowLevelKvDump = {
      async get(key) {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.get", attributes }, async (span) => {
          const cached = cachedValues.get(cacheKey(key));
          span.setAttribute("bulldozer.low_level.instant.cache_hit", cached !== undefined);
          if (cached !== undefined) {
            return {
              buffer: cached.buffer === null ? null : cloneArrayBuffer(cached.buffer),
              seq: cached.seq,
            };
          }

          const { buffer, seq } = await wrappedStore.get(key);
          await wrapped.waitUntilAvailable(seq);
          return { buffer, seq: initialSeq };
        });
      },
      async setAll(entries, setOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.setAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => {
          if (entries.length === 0) return { seq: setOptions?.requiresSeq ?? initialSeq };
          return await withWriteGate(async () => setAllLocked(entries, setOptions));
        });
      },
      async deleteAll(keys) {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.deleteAll", attributes: { ...attributes, "bulldozer.low_level.key_count": keys.length } }, async () => {
          if (keys.length === 0) return { seq: initialSeq };
          return await withWriteGate(async () => {
            const keysForWrapped = keys.map(cloneArrayBuffer);
            const underlyingSeq = (async () => {
              const { seq } = await wrappedStore.deleteAll(keysForWrapped);
              return seq;
            })();
            const seq = createSeq(underlyingSeq);
            for (const key of keys) setCachedValue(key, null, seq);
            evictAfterWrappedAvailability(keys, seq);
            return { seq };
          });
        });
      },
      async insertAll(values, insertOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.insertAll", attributes: { ...attributes, "bulldozer.low_level.value_count": values.length } }, async () => {
          if (values.length === 0) return { keys: [], seq: insertOptions?.requiresSeq ?? initialSeq };
          return await withWriteGate(async () => {
            const valuesForWrapped = values.map(cloneArrayBuffer);
            const requiresSeq = await getUnderlyingSeq(insertOptions?.requiresSeq);
            const { keys, seq: underlyingInsertSeq } = await wrappedStore.insertAll(valuesForWrapped, { requiresSeq });
            const seq = createSeq(Promise.resolve(underlyingInsertSeq));
            keys.forEach((key, index) => setCachedValue(key, values[index], seq));
            evictAfterWrappedAvailability(keys, seq);
            return { keys: keys.map(cloneArrayBuffer), seq };
          });
        });
      },
      async compareAndSet(key, compare, value, compareAndSetOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.compareAndSet", attributes }, async () => {
          // The read+compare must happen inside the SAME write-gate critical section as the
          // subsequent write; otherwise two concurrent calls could both read the same value,
          // both pass the comparison, and both write — each returning wasSet: true, defeating
          // compare-and-set's single-winner guarantee.
          return await withWriteGate(async () => {
            const existing = await result.get(key);
            if (existing.buffer === null || !arrayBuffersAreEqual(existing.buffer, compare)) return { wasSet: false, seq: null };
            const { seq } = setAllLocked([{ key, value }], compareAndSetOptions);
            return { wasSet: true, seq };
          });
        });
      },
      async debugEntries() {
        return await traceSpan({ description: "bulldozer-js.low-level.instant.debugEntries", attributes }, async () => await wrappedStore.debugEntries?.() ?? []);
      },
    };

    return result;
  };

  return {
    getDebugInfo() {
      return {
        backend: "instant-availability",
        constructorArguments: { wrapped, options },
        wrapped,
        dbId,
        maxPendingSeqRecords,
        initialSeq,
        seqRecords,
        createdSeqRecords,
        underlyingAvailableSeqRecords,
        pendingSeqRecords,
        currentWriteGateOperation,
        pendingSeqRecordsChanged,
        cacheMaps,
      };
    },
    declareKvStore(id) {
      return declareStoreOrDump(wrapped.declareKvStore(id) as LowLevelKvStore & LowLevelKvDump);
    },
    declareKvDump(id) {
      return declareStoreOrDump(wrapped.declareKvDump(id) as LowLevelKvStore & LowLevelKvDump);
    },
    async waitUntilAvailable() {
      return await traceSpan({ description: "bulldozer-js.low-level.instant.waitUntilAvailable", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => {});
    },
    async waitUntilDurable(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.instant.waitUntilDurable", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => await wrapped.waitUntilDurable(await getUnderlyingSeq(seq)));
    },
    async waitUntilReplicated(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.instant.waitUntilReplicated", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => await wrapped.waitUntilReplicated(await getUnderlyingSeq(seq)));
    },
    combineSeqs(...seqs) {
      if (seqs.length === 0) return initialSeq;
      const uniqueSeqs = new Set(seqs);
      if (uniqueSeqs.size === 1) return seqs[0];
      if (seqs.every(seq => getSeqId(seq) === initialSeqId)) return initialSeq;
      return createSeq((async () => wrapped.combineSeqs(...await Promise.all(seqs.map(async seq => await getUnderlyingSeq(seq)))))());
    },
    async debugSnapshot() {
      return await traceSpan({ description: "bulldozer-js.low-level.instant.debugSnapshot", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => await wrapped.debugSnapshot?.() ?? { stores: {}, dumps: {} });
    },
    debugInstantAvailability() {
      return {
        createdSeqRecords,
        pendingSeqRecords: pendingSeqRecords.size,
        underlyingAvailableSeqRecords,
        cachedValues: [...cacheMaps].reduce((sum, cachedValues) => sum + cachedValues.size, 0),
      };
    },
    async waitUntilUnderlyingAvailable(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.instant.waitUntilUnderlyingAvailable", attributes: { "bulldozer.low_level.backend": "instant-availability" } }, async () => await getSeqRecord(seq).underlyingAvailable);
    },
    initialSeq,
  };
}
