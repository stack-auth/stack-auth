import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { traceSpan } from "../../../otel.js";
import { Database, DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugEntry, LowLevelKvDump, LowLevelKvStore } from "../index.js";

const inMemoryLowLevelKvStores = new Map<`${"store" | "dump"}-${string}`, LowLevelKvStore & LowLevelKvDump>();
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

export function declareInMemoryLowLevelDatabase(dbId: string): LowLevelDatabase {
  const debugEntriesByStoreId = new Map<`${"store" | "dump"}-${string}`, () => Promise<LowLevelDatabaseDebugEntry[]>>();
  const declareInMemoryLowLevelKvStoreOrDump = (storeOrDump: "store" | "dump", id: string): LowLevelKvStore & LowLevelKvDump => {
    const debugStoreId = `${storeOrDump}-${id}` as const;
    const attributes = { "bulldozer.low_level.backend": "in-memory", "bulldozer.low_level.kind": storeOrDump, "bulldozer.low_level.id": id };
    const existing = inMemoryLowLevelKvStores.get(debugStoreId);
    if (existing) {
      if (existing.debugEntries) debugEntriesByStoreId.set(debugStoreId, () => existing.debugEntries!());
      return existing;
    }

    const base64KeyToValue = new Map<string, ArrayBuffer>;
    const seqSentinel: DatabaseSeq = [] as unknown as DatabaseSeq;
    const result: LowLevelKvStore & LowLevelKvDump = {
      async get(key: ArrayBuffer) {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.get", attributes }, async () => {
          if (key.byteLength > 64) throw new Error("KV store key must be <= 64 bytes");
          return {
            buffer: base64KeyToValue.get(encodeBase64(new Uint8Array(key)))?.slice(0) ?? null,
            seq: seqSentinel,
          };
        });
      },
      async setAll(entries: Array<{ key: ArrayBuffer, value: ArrayBuffer }>) {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.setAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => {
          for (const { key, value } of entries) {
            if (key.byteLength > 64) throw new Error("KV store key must be <= 64 bytes");
            if (value.byteLength > 2_000_000_000) throw new Error("KV store value must be <= 2GB");
            base64KeyToValue.set(encodeBase64(new Uint8Array(key)), value.slice(0));
          }
          return {
            seq: seqSentinel,
          };
        });
      },
      async deleteAll(keys: ArrayBuffer[]) {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.deleteAll", attributes: { ...attributes, "bulldozer.low_level.key_count": keys.length } }, async () => {
          for (const key of keys) {
            if (key.byteLength > 64) throw new Error("KV store key must be <= 64 bytes");
            base64KeyToValue.delete(encodeBase64(new Uint8Array(key)));
          }
          return {
            seq: seqSentinel,
          };
        });
      },
      async insertAll(values: ArrayBuffer[], options: { requiresSeq: DatabaseSeq }) {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.insertAll", attributes: { ...attributes, "bulldozer.low_level.value_count": values.length } }, async () => {
          for (const value of values) {
            if (value.byteLength > 2_000_000_000) throw new Error("KV store value must be <= 2GB");
          }
          const keys = values.map(() => crypto.getRandomValues(new Uint8Array(48)).buffer);
          return {
            keys,
            ...await result.setAll(keys.map((key, index) => ({ key, value: values[index] })), options),
          };
        });
      },
      async compareAndSet(key: ArrayBuffer, compare: ArrayBuffer, value: ArrayBuffer, options: { requiresSeq: DatabaseSeq }) {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.compareAndSet", attributes }, async () => {
          if (key.byteLength > 64) throw new Error("KV store key must be <= 64 bytes");
          if (compare.byteLength > 2_000_000_000) throw new Error("KV store compare must be <= 2GB");
          if (value.byteLength > 2_000_000_000) throw new Error("KV store value must be <= 2GB");
          const base64Key = encodeBase64(new Uint8Array(key));
          const existingValue = base64KeyToValue.get(base64Key);
          if (existingValue === undefined || !arrayBuffersAreEqual(existingValue, compare)) {
            return { wasSet: false, seq: null };
          }
          return {
            wasSet: true,
            ...await result.setAll([{ key, value }], options),
          };
        });
      },
      async debugEntries() {
        return await traceSpan({ description: "bulldozer-js.low-level.in-memory.debugEntries", attributes }, async () => [...base64KeyToValue.entries()]
          .sort(([a], [b]) => stringCompare(a, b))
          .map(([keyBase64, value]) => {
            const keyBytes = Buffer.from(keyBase64, "base64");
            return {
              keyBase64,
              keyUtf8: decodeUtf8(arrayBufferFromUint8Array(keyBytes)),
              keyHex: encodeHex(keyBytes),
              valueBase64: encodeBase64(new Uint8Array(value)),
              valueUtf8: decodeUtf8(value),
              valueByteLength: value.byteLength,
            };
          }));
      },
    };
    inMemoryLowLevelKvStores.set(debugStoreId, result);
    debugEntriesByStoreId.set(debugStoreId, () => result.debugEntries!());
    return result;
  };

  return {
    getDebugInfo() {
      return {
        backend: "in-memory",
        constructorArguments: { dbId },
        inMemoryLowLevelKvStores,
        debugEntriesByStoreId,
      };
    },
    declareKvDump(dumpId) {
      return declareInMemoryLowLevelKvStoreOrDump("dump", JSON.stringify([dbId, dumpId]));
    },
    declareKvStore(storeId) {
      return declareInMemoryLowLevelKvStoreOrDump("store", JSON.stringify([dbId, storeId]));
    },
    async waitUntilAvailable() {
      return await traceSpan({ description: "bulldozer-js.low-level.in-memory.waitUntilAvailable", attributes: { "bulldozer.low_level.backend": "in-memory" } }, async () => {});
    },
    async waitUntilDurable() {
      return await traceSpan({ description: "bulldozer-js.low-level.in-memory.waitUntilDurable", attributes: { "bulldozer.low_level.backend": "in-memory" } }, async () => {});
    },
    async waitUntilReplicated() {
      return await traceSpan({ description: "bulldozer-js.low-level.in-memory.waitUntilReplicated", attributes: { "bulldozer.low_level.backend": "in-memory" } }, async () => {});
    },
    combineSeqs(...seqs) {
      return this.initialSeq;
    },
    async debugSnapshot() {
      return await traceSpan({ description: "bulldozer-js.low-level.in-memory.debugSnapshot", attributes: { "bulldozer.low_level.backend": "in-memory" } }, async () => {
        const stores: Record<string, LowLevelDatabaseDebugEntry[]> = {};
        const dumps: Record<string, LowLevelDatabaseDebugEntry[]> = {};
        for (const [storeId, entries] of debugEntriesByStoreId.entries()) {
          if (storeId.startsWith("store-")) {
            stores[String(JSON.parse(storeId.slice("store-".length))[1])] = await entries();
          } else {
            dumps[String(JSON.parse(storeId.slice("dump-".length))[1])] = await entries();
          }
        }
        return { stores, dumps };
      });
    },
    initialSeq: [] as unknown as DatabaseSeq,
  };
}

