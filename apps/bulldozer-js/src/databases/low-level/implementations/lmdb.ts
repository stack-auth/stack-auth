import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { wait } from "@hexclave/shared/dist/utils/promises";
import * as lmdb from "lmdb";
import { traceSpan } from "../../../otel.js";
import { DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugEntry, LowLevelKvDump, LowLevelKvStore } from "../index.js";

type LmdbSeq = readonly [dbId: string, seqId: string] & { __brand: "hexclave-low-level-kv-store-seq" };
type BinaryDatabase = lmdb.Database<Buffer, Uint8Array>;
type VersionedBinaryDatabase = BinaryDatabase & {
  getEntry(key: Buffer): { value: Buffer, version?: number } | undefined,
};

function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const aUint8Array = new Uint8Array(a);
  const bUint8Array = new Uint8Array(b);
  for (let i = 0; i < aUint8Array.length; i++) {
    if (aUint8Array[i] !== bUint8Array[i]) return false;
  }
  return true;
}

function arrayBufferFromUint8Array(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bufferFromArrayBuffer(value: ArrayBuffer) {
  return Buffer.from(value);
}

function encodeHex(value: Uint8Array) {
  return [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function decodeUtf8(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function validateKey(key: ArrayBuffer) {
  if (key.byteLength > 64) throw new Error("KV store key must be <= 64 bytes");
}

function validateValue(name: string, value: ArrayBuffer) {
  if (value.byteLength > 2_000_000_000) throw new Error(`KV store ${name} must be <= 2GB`);
}

type LmdbActivityStats = {
  puts: number,
  transactions: number,
  waitUntilAvailableResolves: number,
  waitUntilDurableResolves: number,
  waitUntilAvailableResolveTotalMs: number,
  waitUntilDurableResolveTotalMs: number,
  combinedSeqAvailabilityResolves: number,
  combinedSeqDurabilityResolves: number,
  combinedSeqAvailabilityResolveTotalMs: number,
  combinedSeqDurabilityResolveTotalMs: number,
};

function emptyActivityStats(): LmdbActivityStats {
  return {
    puts: 0,
    transactions: 0,
    waitUntilAvailableResolves: 0,
    waitUntilDurableResolves: 0,
    waitUntilAvailableResolveTotalMs: 0,
    waitUntilDurableResolveTotalMs: 0,
    combinedSeqAvailabilityResolves: 0,
    combinedSeqDurabilityResolves: 0,
    combinedSeqAvailabilityResolveTotalMs: 0,
    combinedSeqDurabilityResolveTotalMs: 0,
  };
}

function hasActivity(stats: LmdbActivityStats): boolean {
  return stats.puts > 0
    || stats.transactions > 0
    || stats.waitUntilAvailableResolves > 0
    || stats.waitUntilDurableResolves > 0
    || stats.combinedSeqAvailabilityResolves > 0
    || stats.combinedSeqDurabilityResolves > 0;
}

export function declareLmdbLowLevelDatabase(options: { path: string, dbId?: string, simulateReadMissDelayMs?: number }): LowLevelDatabase {
  const dbId = options.dbId ?? "default";
  const simulateReadMissDelayMs = options.simulateReadMissDelayMs ?? 0;
  if (!Number.isFinite(simulateReadMissDelayMs) || simulateReadMissDelayMs < 0) throw new Error("simulateReadMissDelayMs must be a non-negative finite number");
  const root = lmdb.open({ path: options.path, maxDbs: 1024, separateFlushed: true });
  const meta = root.openDB<number, string>({ name: `${dbId}:meta`, encoding: "json" });
  let currentVersion = meta.get("seq") ?? 0;
  const initialSeqId = "initial";
  const debugEntriesByStoreId = new Map<`${"store" | "dump"}-${string}`, () => Promise<LowLevelDatabaseDebugEntry[]>>();
  const seqToAvailability = new Map<string, Promise<void>>();
  const seqToDurability = new Map<string, Promise<void>>();
  const combinedSeqToAvailability = new Map<string, Promise<void>>();
  const combinedSeqToDurability = new Map<string, Promise<void>>();
  let activityStats = emptyActivityStats();
  let activityWindowStartedAt = performance.now();
  const activityInterval = setInterval(() => {
    if (!hasActivity(activityStats)) return;
    const now = performance.now();
    const elapsedMs = now - activityWindowStartedAt;
    const elapsedSeconds = elapsedMs / 1000;
    console.debug("bulldozer-js low-level lmdb activity", {
      dbId,
      elapsedMs,
      putsPerSecond: activityStats.puts / elapsedSeconds,
      transactionsPerSecond: activityStats.transactions / elapsedSeconds,
      waitUntilAvailableResolvesPerSecond: activityStats.waitUntilAvailableResolves / elapsedSeconds,
      waitUntilDurableResolvesPerSecond: activityStats.waitUntilDurableResolves / elapsedSeconds,
      averageSeqToAvailabilityResolveMs: activityStats.waitUntilAvailableResolves === 0 ? 0 : activityStats.waitUntilAvailableResolveTotalMs / activityStats.waitUntilAvailableResolves,
      averageSeqToDurabilityResolveMs: activityStats.waitUntilDurableResolves === 0 ? 0 : activityStats.waitUntilDurableResolveTotalMs / activityStats.waitUntilDurableResolves,
      combinedSeqAvailabilityResolvesPerSecond: activityStats.combinedSeqAvailabilityResolves / elapsedSeconds,
      combinedSeqDurabilityResolvesPerSecond: activityStats.combinedSeqDurabilityResolves / elapsedSeconds,
      averageCombinedSeqAvailabilityResolveMs: activityStats.combinedSeqAvailabilityResolves === 0 ? 0 : activityStats.combinedSeqAvailabilityResolveTotalMs / activityStats.combinedSeqAvailabilityResolves,
      averageCombinedSeqDurabilityResolveMs: activityStats.combinedSeqDurabilityResolves === 0 ? 0 : activityStats.combinedSeqDurabilityResolveTotalMs / activityStats.combinedSeqDurabilityResolves,
      mapSizes: {
        seqToAvailability: seqToAvailability.size,
        seqToDurability: seqToDurability.size,
        combinedSeqToAvailability: combinedSeqToAvailability.size,
        combinedSeqToDurability: combinedSeqToDurability.size,
        debugEntriesByStoreId: debugEntriesByStoreId.size,
      },
      currentVersion,
    });
    activityStats = emptyActivityStats();
    activityWindowStartedAt = now;
  }, 5_000);
  activityInterval.unref();
  const initialSeq = [dbId, initialSeqId] as unknown as LmdbSeq;
  const toSeq = (seqId: string) => [dbId, seqId] as unknown as LmdbSeq;

  const nextVersion = () => ++currentVersion;
  const nextSeqId = () => crypto.randomUUID();
  const getSeqId = (seq: DatabaseSeq | undefined) => {
    if (seq === undefined) return initialSeqId;
    if (seq[0] !== dbId || typeof seq[1] !== "string") throw new Error("LMDB sequence does not belong to this database");
    return seq[1];
  };
  const getAvailabilityPromise = (seqId: string) => {
    return seqToAvailability.get(seqId) ?? combinedSeqToAvailability.get(seqId) ?? Promise.resolve();
  };
  const getDurabilityPromise = (seqId: string) => {
    return seqToDurability.get(seqId) ?? combinedSeqToDurability.get(seqId) ?? Promise.resolve();
  };
  const rememberAvailability = (seqId: string, promise: Promise<unknown>) => {
    const insertedAt = performance.now();
    const availability = traceSpan({ description: "bulldozer-js.low-level.lmdb.availability", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await promise.then(() => {
      activityStats.waitUntilAvailableResolveTotalMs += performance.now() - insertedAt;
      activityStats.waitUntilAvailableResolves++;
      seqToAvailability.delete(seqId);
    }));
    availability.catch(() => {});
    seqToAvailability.set(seqId, availability);
  };
  const rememberDurability = (seqId: string, promise: Promise<unknown>) => {
    const insertedAt = performance.now();
    const durability = traceSpan({ description: "bulldozer-js.low-level.lmdb.durability", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await promise.then(async () => await root.flushed).then(() => {
      activityStats.waitUntilDurableResolveTotalMs += performance.now() - insertedAt;
      activityStats.waitUntilDurableResolves++;
      seqToDurability.delete(seqId);
    }));
    durability.catch(() => {});
    seqToDurability.set(seqId, durability);
  };
  const rememberCombinedAvailability = (seqId: string, promise: Promise<unknown>) => {
    const insertedAt = performance.now();
    const availability = traceSpan({ description: "bulldozer-js.low-level.lmdb.combinedAvailability", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await promise.then(() => {
      activityStats.combinedSeqAvailabilityResolveTotalMs += performance.now() - insertedAt;
      activityStats.combinedSeqAvailabilityResolves++;
      combinedSeqToAvailability.delete(seqId);
    }));
    availability.catch(() => {});
    combinedSeqToAvailability.set(seqId, availability);
  };
  const rememberCombinedDurability = (seqId: string, promise: Promise<unknown>) => {
    const insertedAt = performance.now();
    const durability = traceSpan({ description: "bulldozer-js.low-level.lmdb.combinedDurability", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await promise.then(() => {
      activityStats.combinedSeqDurabilityResolveTotalMs += performance.now() - insertedAt;
      activityStats.combinedSeqDurabilityResolves++;
      combinedSeqToDurability.delete(seqId);
    }));
    durability.catch(() => {});
    combinedSeqToDurability.set(seqId, durability);
  };
  const trackCommit = (seqId: string, promise: Promise<unknown>) => {
    rememberAvailability(seqId, promise);
    rememberDurability(seqId, promise);
    return toSeq(seqId);
  };
  const commit = (requiresSeq: DatabaseSeq, action: (version: number) => Promise<void>) => {
    const version = nextVersion();
    const seqId = nextSeqId();
    const promise = traceSpan({ description: "bulldozer-js.low-level.lmdb.commit", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await waitUntilAvailable(requiresSeq).then(async () => await root.transaction(() => {
      activityStats.transactions++;
      return (async () => {
        await action(version);
        await meta.put("seq", version);
      })();
    })));
    return trackCommit(seqId, promise);
  };
  const commitIfVersion = async (db: BinaryDatabase, key: Buffer, version: number, action: (version: number) => Promise<void>) => {
    const nextVersionRef: { value: number | null } = { value: null };
    const seqId = nextSeqId();
    const wasSet = await db.ifVersion(key, version, () => {
      return (async () => {
        nextVersionRef.value = nextVersion();
        await action(nextVersionRef.value);
        await meta.put("seq", nextVersionRef.value);
      })();
    });
    if (!wasSet) return null;
    if (nextVersionRef.value === null) throw new Error("Assertion error: LMDB compare-and-set succeeded without assigning a version");
    rememberAvailability(seqId, root.committed);
    rememberDurability(seqId, Promise.resolve());
    return toSeq(seqId);
  };
  const dumpKeyForVersion = (version: number, index: number) => {
    const key = crypto.getRandomValues(new Uint8Array(48));
    new DataView(key.buffer).setBigUint64(0, BigInt(version));
    new DataView(key.buffer).setUint32(8, index);
    return key.buffer;
  };
  const putWithVersion = async (db: BinaryDatabase, key: Buffer, value: Buffer, version: number) => {
    activityStats.puts++;
    await db.put(key, value, version);
  };
  const waitUntilAvailable = async (seq: DatabaseSeq) => {
    await getAvailabilityPromise(getSeqId(seq));
  };
  const waitUntilDurable = async (seq: DatabaseSeq) => {
    await getDurabilityPromise(getSeqId(seq));
  };
  const waitUntilAllAvailable = async () => {
    await Promise.all(seqToAvailability.values());
  };

  const declareLmdbLowLevelKvStoreOrDump = (storeOrDump: "store" | "dump", id: string): LowLevelKvStore & LowLevelKvDump => {
    const debugStoreId = `${storeOrDump}-${id}` as const;
    const attributes = { "bulldozer.low_level.backend": "lmdb", "bulldozer.low_level.kind": storeOrDump, "bulldozer.low_level.id": id };
    const db = root.openDB<Buffer, Uint8Array>({
      name: `${dbId}:${storeOrDump}:${id}`,
      encoding: "binary",
      keyEncoding: "binary",
      useVersions: true,
    }) as VersionedBinaryDatabase;

    const result: LowLevelKvStore & LowLevelKvDump = {
      async get(key) {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.get", attributes }, async () => {
          validateKey(key);
          if (simulateReadMissDelayMs > 0) await wait(simulateReadMissDelayMs);
          const [buffer] = await db.getMany([bufferFromArrayBuffer(key)]);
          return {
            buffer: buffer ? arrayBufferFromUint8Array(buffer) : null,
            seq: initialSeq,
          };
        });
      },
      async setAll(entries, setOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.setAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => {
          for (const { key, value } of entries) {
            validateKey(key);
            validateValue("value", value);
          }
          if (entries.length === 0) return { seq: setOptions?.requiresSeq ?? initialSeq };
          return {
            seq: commit(setOptions?.requiresSeq ?? initialSeq, async version => {
              for (const { key, value } of entries) {
                await putWithVersion(db, bufferFromArrayBuffer(key), bufferFromArrayBuffer(value), version);
              }
            }),
          };
        });
      },
      async deleteAll(keys) {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.deleteAll", attributes: { ...attributes, "bulldozer.low_level.key_count": keys.length } }, async () => {
          for (const key of keys) validateKey(key);
          if (keys.length === 0) return { seq: initialSeq };
          return {
            seq: commit(initialSeq, async () => {
              for (const key of keys) await db.remove(bufferFromArrayBuffer(key));
            }),
          };
        });
      },
      async insertAll(values, insertOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.insertAll", attributes: { ...attributes, "bulldozer.low_level.value_count": values.length } }, async () => {
          for (const value of values) validateValue("value", value);
          if (values.length === 0) return { keys: [], seq: insertOptions?.requiresSeq ?? initialSeq };
          const version = nextVersion();
          const seqId = nextSeqId();
          const keys = values.map((_, index) => dumpKeyForVersion(version, index));
          const promise = traceSpan({ description: "bulldozer-js.low-level.lmdb.insertAll.commit", attributes }, async () => await waitUntilAvailable(insertOptions?.requiresSeq ?? initialSeq).then(async () => await root.transaction(() => {
            activityStats.transactions++;
            return (async () => {
              for (let i = 0; i < values.length; i++) {
                await putWithVersion(db, bufferFromArrayBuffer(keys[i]), bufferFromArrayBuffer(values[i]), version);
              }
              await meta.put("seq", version);
            })();
          })));
          return { keys, seq: trackCommit(seqId, promise) };
        });
      },
      async compareAndSet(key, compare, value, casOptions) {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.compareAndSet", attributes }, async () => {
          validateKey(key);
          validateValue("compare", compare);
          validateValue("value", value);
          await waitUntilAvailable(casOptions?.requiresSeq ?? initialSeq);
          await waitUntilAllAvailable();
          const keyBuffer = bufferFromArrayBuffer(key);
          const existing = db.getEntry(keyBuffer);
          if (!existing || existing.version === undefined || !arrayBuffersAreEqual(arrayBufferFromUint8Array(existing.value), compare)) {
            return { wasSet: false, seq: null };
          }
          const seq = await commitIfVersion(db, keyBuffer, existing.version, async version => await putWithVersion(db, keyBuffer, bufferFromArrayBuffer(value), version));
          return seq === null ? { wasSet: false, seq: null } : { wasSet: true, seq };
        });
      },
      async debugEntries() {
        return await traceSpan({ description: "bulldozer-js.low-level.lmdb.debugEntries", attributes }, async () => await (db.getRange() as lmdb.RangeIterable<{ key: Uint8Array, value: Buffer }>).map(({ key, value }) => {
          const keyBuffer = Buffer.from(key);
          const valueBuffer = Buffer.from(value);
          return {
            keyBase64: encodeBase64(new Uint8Array(arrayBufferFromUint8Array(keyBuffer))),
            keyUtf8: decodeUtf8(arrayBufferFromUint8Array(keyBuffer)),
            keyHex: encodeHex(keyBuffer),
            valueBase64: encodeBase64(new Uint8Array(arrayBufferFromUint8Array(valueBuffer))),
            valueUtf8: decodeUtf8(arrayBufferFromUint8Array(valueBuffer)),
            valueByteLength: valueBuffer.byteLength,
          };
        }).asArray);
      },
    };
    debugEntriesByStoreId.set(debugStoreId, () => result.debugEntries!());
    return result;
  };

  return {
    getDebugInfo() {
      return {
        backend: "lmdb",
        constructorArguments: options,
        dbId,
        simulateReadMissDelayMs,
        root,
        meta,
        currentVersion,
        debugEntriesByStoreId,
        seqToAvailability,
        seqToDurability,
        combinedSeqToAvailability,
        combinedSeqToDurability,
        initialSeq,
      };
    },
    declareKvDump(dumpId) {
      return declareLmdbLowLevelKvStoreOrDump("dump", dumpId);
    },
    declareKvStore(storeId) {
      return declareLmdbLowLevelKvStoreOrDump("store", storeId);
    },
    async waitUntilAvailable(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.lmdb.waitUntilAvailable", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await waitUntilAvailable(seq));
    },
    async waitUntilDurable(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.lmdb.waitUntilDurable", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => await waitUntilDurable(seq));
    },
    async waitUntilReplicated(seq) {
      await traceSpan({ description: "bulldozer-js.low-level.lmdb.waitUntilReplicated", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => {
        await this.waitUntilAvailable(seq);
        await this.waitUntilDurable(seq);
      });
    },
    combineSeqs(...seqs) {
      if (seqs.length === 0) return initialSeq;
      const seqId = nextSeqId();
      rememberCombinedAvailability(seqId, Promise.all(seqs.map(seq => getAvailabilityPromise(getSeqId(seq)))));
      rememberCombinedDurability(seqId, Promise.all(seqs.map(seq => getDurabilityPromise(getSeqId(seq)))));
      return toSeq(seqId);
    },
    async debugSnapshot() {
      return await traceSpan({ description: "bulldozer-js.low-level.lmdb.debugSnapshot", attributes: { "bulldozer.low_level.backend": "lmdb" } }, async () => {
        const stores: Record<string, LowLevelDatabaseDebugEntry[]> = {};
        const dumps: Record<string, LowLevelDatabaseDebugEntry[]> = {};
        for (const [storeId, entries] of debugEntriesByStoreId.entries()) {
          if (storeId.startsWith("store-")) {
            stores[storeId.slice("store-".length)] = await entries();
          } else {
            dumps[storeId.slice("dump-".length)] = await entries();
          }
        }
        return { stores, dumps };
      });
    },
    initialSeq,
  };
}
