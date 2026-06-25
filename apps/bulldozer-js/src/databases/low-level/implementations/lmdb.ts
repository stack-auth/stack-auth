import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { wait } from "@hexclave/shared/dist/utils/promises";
import * as lmdb from "lmdb";
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
  const availableSeqIds = new Set<string>([initialSeqId]);
  const durableSeqIds = new Set<string>([initialSeqId]);
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
    if (availableSeqIds.has(seqId)) return Promise.resolve();
    const promise = seqToAvailability.get(seqId);
    if (promise === undefined) throw new Error("Unknown LMDB availability sequence");
    return promise;
  };
  const getDurabilityPromise = (seqId: string) => {
    if (durableSeqIds.has(seqId)) return Promise.resolve();
    const promise = seqToDurability.get(seqId);
    if (promise === undefined) throw new Error("Unknown LMDB durability sequence");
    return promise;
  };
  const rememberAvailability = (seqId: string, promise: Promise<unknown>) => {
    const availability = promise.then(() => {
      availableSeqIds.add(seqId);
      seqToAvailability.delete(seqId);
    });
    availability.catch(() => {});
    seqToAvailability.set(seqId, availability);
  };
  const rememberDurability = (seqId: string, promise: Promise<unknown>) => {
    const durability = promise.then(async () => await root.flushed).then(() => {
      durableSeqIds.add(seqId);
      seqToDurability.delete(seqId);
    });
    durability.catch(() => {});
    seqToDurability.set(seqId, durability);
  };
  const trackCommit = (seqId: string, promise: Promise<unknown>) => {
    rememberAvailability(seqId, promise);
    rememberDurability(seqId, promise);
    return toSeq(seqId);
  };
  const commit = (requiresSeq: DatabaseSeq, action: (version: number) => Promise<void>) => {
    const version = nextVersion();
    const seqId = nextSeqId();
    const promise = waitUntilAvailable(requiresSeq).then(async () => await root.transaction(() => {
      return (async () => {
        await action(version);
        await meta.put("seq", version);
      })();
    }));
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
    await db.put(key, value, version);
  };
  const waitUntilAvailable = async (seq: DatabaseSeq) => {
    await getAvailabilityPromise(getSeqId(seq));
  };
  const waitUntilAllAvailable = async () => {
    await Promise.all(seqToAvailability.values());
  };

  const declareLmdbLowLevelKvStoreOrDump = (storeOrDump: "store" | "dump", id: string): LowLevelKvStore & LowLevelKvDump => {
    const debugStoreId = `${storeOrDump}-${id}` as const;
    const db = root.openDB<Buffer, Uint8Array>({
      name: `${dbId}:${storeOrDump}:${id}`,
      encoding: "binary",
      keyEncoding: "binary",
      useVersions: true,
    }) as VersionedBinaryDatabase;

    const result: LowLevelKvStore & LowLevelKvDump = {
      async get(key) {
        validateKey(key);
        if (simulateReadMissDelayMs > 0) await wait(simulateReadMissDelayMs);
        const [buffer] = await db.getMany([bufferFromArrayBuffer(key)]);
        return {
          buffer: buffer ? arrayBufferFromUint8Array(buffer) : null,
          seq: initialSeq,
        };
      },
      async setAll(entries, setOptions) {
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
      },
      async deleteAll(keys) {
        for (const key of keys) validateKey(key);
        if (keys.length === 0) return { seq: initialSeq };
        return {
          seq: commit(initialSeq, async () => {
            for (const key of keys) await db.remove(bufferFromArrayBuffer(key));
          }),
        };
      },
      async insertAll(values, insertOptions) {
        for (const value of values) validateValue("value", value);
        if (values.length === 0) return { keys: [], seq: insertOptions?.requiresSeq ?? initialSeq };
        const version = nextVersion();
        const seqId = nextSeqId();
        const keys = values.map((_, index) => dumpKeyForVersion(version, index));
        const promise = waitUntilAvailable(insertOptions?.requiresSeq ?? initialSeq).then(async () => await root.transaction(() => {
          return (async () => {
            for (let i = 0; i < values.length; i++) {
              await putWithVersion(db, bufferFromArrayBuffer(keys[i]), bufferFromArrayBuffer(values[i]), version);
            }
            await meta.put("seq", version);
          })();
        }));
        return { keys, seq: trackCommit(seqId, promise) };
      },
      async compareAndSet(key, compare, value, casOptions) {
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
      },
      async debugEntries() {
        return await (db.getRange() as lmdb.RangeIterable<{ key: Uint8Array, value: Buffer }>).map(({ key, value }) => {
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
        }).asArray;
      },
    };
    debugEntriesByStoreId.set(debugStoreId, () => result.debugEntries!());
    return result;
  };

  return {
    declareKvDump(dumpId) {
      return declareLmdbLowLevelKvStoreOrDump("dump", dumpId);
    },
    declareKvStore(storeId) {
      return declareLmdbLowLevelKvStoreOrDump("store", storeId);
    },
    waitUntilAvailable,
    async waitUntilDurable(seq) {
      await getDurabilityPromise(getSeqId(seq));
    },
    async waitUntilReplicated(seq) {
      await this.waitUntilAvailable(seq);
      await this.waitUntilDurable(seq);
    },
    combineSeqs(...seqs) {
      if (seqs.length === 0) return initialSeq;
      const seqId = nextSeqId();
      rememberAvailability(seqId, Promise.all(seqs.map(seq => getAvailabilityPromise(getSeqId(seq)))));
      rememberDurability(seqId, Promise.all(seqs.map(seq => getDurabilityPromise(getSeqId(seq)))));
      return toSeq(seqId);
    },
    async debugSnapshot() {
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
    },
    initialSeq,
  };
}
