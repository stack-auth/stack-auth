import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { Database, DatabaseSeq } from "../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugSnapshot } from "../low-level/index.js";

export const isPiledriverHeapObjectSymbol = Symbol.for("hexclave-piledriver-heap-object-symbol");
export type PiledriverHeapObject = {
  get(): Promise<PiledriverObject>,
  [isPiledriverHeapObjectSymbol]: true,
};

const heapObjectsMapNullSentinel = { __heapObjectsMapNullSentinel: true };
const heapObjectsByObject = new WeakMap<PiledriverObject & object, PiledriverHeapObject>();
/**
 * Creates a new heap object, which will be stored as a reference by Piledriver.
 *
 * Accessing it will take an extra database lookup, but becomes an optional operation.
 *
 * Note that since Piledriver objects are inherently immutable, `obj` must be immutable as well. Behavior is undefined
 * if it is modified after being passed to this function.
 */
export function asHeapObject(obj: PiledriverObject): PiledriverHeapObject {
  if (typeof obj !== "object") throw new Error("Can only create heap objects from actual objects!");
  const existing = heapObjectsByObject.get(obj ?? heapObjectsMapNullSentinel);
  if (existing) return existing;

  const res: PiledriverHeapObject = {
    async get() {
      return obj;
    },
    [isPiledriverHeapObjectSymbol]: true,
  };
  heapObjectsByObject.set(obj ?? heapObjectsMapNullSentinel, res);
  return res;
}

export type PiledriverObject = string | number | boolean | null | PiledriverObject[] | { [key: string]: PiledriverObject } | PiledriverHeapObject;
export function piledriverObjectEquals(a: PiledriverObject, b: PiledriverObject): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => piledriverObjectEquals(v, b[i]));
    }
    const aEntries = Object.entries(a);
    const bRecord = b as { [key: string]: PiledriverObject };
    return aEntries.length === Object.keys(bRecord).length && aEntries.every(([k, v]) => piledriverObjectEquals(v, bRecord[k]));
  }
  return false;
}

export type PiledriverDatabase = Database & {
  getRootObject(key: ArrayBuffer): Promise<{ object: PiledriverObject, seq: DatabaseSeq }>,
  setRootObject(key: ArrayBuffer, value: PiledriverObject): Promise<{ seq: DatabaseSeq }>,
  deleteRootObject(key: ArrayBuffer): Promise<{ seq: DatabaseSeq }>,
  debugSnapshot?(): Promise<PiledriverDatabaseDebugSnapshot>,
  debugLowLevelSnapshot?(): Promise<LowLevelDatabaseDebugSnapshot>,
};

export type PiledriverDatabaseDebugSnapshot = {
  roots: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
  heap: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
};
export type PiledriverDatabaseOptions = {
  disableHeapReadCache?: boolean,
};

// Tracks the chain of objects currently being serialized, so cycles fail fast with a clear
// error instead of hanging (a heap cycle would deadlock on its own memoized promise, and a
// plain object cycle would recurse forever). Sibling/DAG sharing is fine: only true ancestors
// are in the path.
type SerializationPath = {
  objects: ReadonlySet<object>,
  heapObjects: ReadonlySet<PiledriverHeapObject>,
};
const emptySerializationPath: SerializationPath = { objects: new Set(), heapObjects: new Set() };

export function declarePiledriverDatabase(lowLevelDb: LowLevelDatabase, options: PiledriverDatabaseOptions = {}): PiledriverDatabase {
  // TODO actually support cycles both for heap and non-heap objects (right now they are detected and rejected)

  const rootStore = lowLevelDb.declareKvStore("root");
  const heapDump = lowLevelDb.declareKvDump("heap");

  const heapObjectsByHeapKeyBase64 = new Map<string, [string, Promise<{ object: WeakRef<PiledriverHeapObject>, seq: DatabaseSeq } | null>]>();
  const heapObjectsByHeapKeyFinalizer = new FinalizationRegistry(([keyBase64, refIdentity]: [string, string]) => heapObjectsByHeapKeyBase64.get(keyBase64)?.[0] === refIdentity && heapObjectsByHeapKeyBase64.delete(keyBase64));
  const heapKeysAndSeqByHeapObjects = new WeakMap<PiledriverHeapObject, Promise<{ key: ArrayBuffer, seq: DatabaseSeq }>>();

  const getHeapKeyAndSeq = async (heapObj: PiledriverHeapObject, path: SerializationPath = emptySerializationPath): Promise<{ key: ArrayBuffer, seq: DatabaseSeq }> => {
    // Must be checked before the memo lookup: awaiting the memoized promise of an ancestor
    // that is still being serialized would deadlock.
    if (path.heapObjects.has(heapObj)) throw new Error("Piledriver objects must not contain cycles (found a cycle of heap objects)");

    const existing = heapKeysAndSeqByHeapObjects.get(heapObj);
    if (existing) return await existing;

    const promise = (async () => {
      // A heap object starts a fresh plain-object path; plain object cycles can't span heap
      // boundaries without also forming a heap cycle, which is tracked separately.
      const childPath: SerializationPath = { objects: new Set(), heapObjects: new Set(path.heapObjects).add(heapObj) };
      const serialized = await serializePiledriverObject(await heapObj.get(), childPath);
      const inserted = await heapDump.insertAll([serialized.buffer]);
      return {
        key: inserted.keys[0],
        seq: lowLevelDb.combineSeqs(serialized.seq, inserted.seq),
      };
    })();
    heapKeysAndSeqByHeapObjects.set(heapObj, promise);
    let result;
    try {
      result = await promise;
    } catch (error) {
      // Don't leave a poisoned rejected promise in the cache; a later retry may succeed.
      if (heapKeysAndSeqByHeapObjects.get(heapObj) === promise) heapKeysAndSeqByHeapObjects.delete(heapObj);
      throw error;
    }
    const keyBase64 = encodeBase64(new Uint8Array(result.key));
    const refIdentity = crypto.randomUUID();
    heapObjectsByHeapKeyBase64.set(keyBase64, [refIdentity, Promise.resolve({ object: new WeakRef(heapObj), seq: result.seq })]);
    heapObjectsByHeapKeyFinalizer.register(heapObj, [keyBase64, refIdentity]);
    return result;
  };

  const getHeapObjectByKey = async (key: ArrayBuffer): Promise<{ object: PiledriverHeapObject | null, seq: DatabaseSeq }> => {
    const keyBase64 = encodeBase64(new Uint8Array(key));
    const existingEntry = heapObjectsByHeapKeyBase64.get(keyBase64);
    if (!options.disableHeapReadCache && existingEntry) {
      const existing = (await existingEntry[1]);
      if (existing === null) return { object: null, seq: lowLevelDb.initialSeq };
      const existingObject = existing.object.deref();
      if (existingObject) {
        return {
          object: existingObject,
          seq: existing.seq,
        };
      } else {
        // object has been gc'd, let's not return it from cache and just fetch it again below
      }
    }

    const promise = (async () => {
      const { buffer, seq } = await heapDump.get(key);
      if (buffer === null) return { object: null, seq };
      const deserialized = await deserializePiledriverObject(buffer);
      return { object: asHeapObject(deserialized.object), seq: lowLevelDb.combineSeqs(deserialized.seq, seq) };
    })();
    const refIdentity = crypto.randomUUID();
    if (!options.disableHeapReadCache) heapObjectsByHeapKeyBase64.set(keyBase64, [refIdentity, promise.then(p => p.object === null ? null : { object: new WeakRef(p.object), seq: p.seq })]);
    let heapObjAndSeq;
    try {
      heapObjAndSeq = await promise;
    } catch (error) {
      if (!options.disableHeapReadCache) heapObjectsByHeapKeyBase64.delete(keyBase64);
      throw error;
    }
    if (heapObjAndSeq.object === null) {
      if (!options.disableHeapReadCache) heapObjectsByHeapKeyBase64.delete(keyBase64);
      return { object: null, seq: lowLevelDb.initialSeq };
    }
    if (!options.disableHeapReadCache) {
      heapObjectsByHeapKeyFinalizer.register(heapObjAndSeq.object, [keyBase64, refIdentity]);
    }
    heapKeysAndSeqByHeapObjects.set(heapObjAndSeq.object, Promise.resolve({ key, seq: heapObjAndSeq.seq }));
    return heapObjAndSeq;
  };

  const serializePiledriverObjectToJsonableObject = async (obj: PiledriverObject, path: SerializationPath): Promise<{ jsonableObject: unknown, seq: DatabaseSeq }> => {
    switch (typeof obj) {
      case "number": {
        if (!Number.isFinite(obj)) return { jsonableObject: [obj.toString()], seq: lowLevelDb.initialSeq };
        if (Object.is(obj, -0)) return { jsonableObject: ["-0"], seq: lowLevelDb.initialSeq };
        // intentionally fall through to the primitive case below
      }
      case "string":
      case "boolean": {
        return { jsonableObject: obj, seq: lowLevelDb.initialSeq };
      }
      case "object": {
        if (obj === null) {
          return { jsonableObject: obj, seq: lowLevelDb.initialSeq };
        } else if (Array.isArray(obj)) {
          if (path.objects.has(obj)) throw new Error("Piledriver objects must not contain cycles");
          const childPath: SerializationPath = { ...path, objects: new Set(path.objects).add(obj) };
          const itemsSerializeResults = await Promise.all(obj.map(async o => await serializePiledriverObjectToJsonableObject(o, childPath)));
          return {
            jsonableObject: ["array", itemsSerializeResults.map(r => r.jsonableObject)],
            seq: lowLevelDb.combineSeqs(...itemsSerializeResults.map(r => r.seq)),
          };
        } else if (isPiledriverHeapObjectSymbol in obj) {
          const heapKeyAndSeq = await getHeapKeyAndSeq(obj, path);
          return {
            jsonableObject: ["heap-reference", encodeBase64(new Uint8Array(heapKeyAndSeq.key))],
            seq: heapKeyAndSeq.seq,
          };
        } else {
          // "normal" object
          // TODO: assert this is a POJO

          if (path.objects.has(obj)) throw new Error("Piledriver objects must not contain cycles");
          const childPath: SerializationPath = { ...path, objects: new Set(path.objects).add(obj) };
          const entriesSerializeResults = await Promise.all(Object.entries(obj).map(async ([k, v]) => [k, await serializePiledriverObjectToJsonableObject(v, childPath)] as const));
          return {
            jsonableObject: Object.fromEntries(entriesSerializeResults.map(([k, v]) => [k, v.jsonableObject] as const)),
            seq: lowLevelDb.combineSeqs(...entriesSerializeResults.map(([_, v]) => v.seq)),
          };
        }
      }
      default: {
        throw new Error("Assertion error: Unknown type of Piledriver object " + typeof obj);
      }
    }
  };

  const serializePiledriverObject = async (obj: PiledriverObject, path: SerializationPath = emptySerializationPath): Promise<{ buffer: ArrayBuffer, seq: DatabaseSeq }> => {
    const toJsonableResponse = await serializePiledriverObjectToJsonableObject(obj, path);
    return {
      buffer: new TextEncoder().encode(JSON.stringify(toJsonableResponse.jsonableObject)).buffer,
      seq: toJsonableResponse.seq,
    };
  };

  const deserializePiledriverObjectFromJsonableObject = async (jsonableObject: unknown): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> => {
    switch (typeof jsonableObject) {
      case "string":
      case "number":
      case "boolean": {
        return { object: jsonableObject, seq: lowLevelDb.initialSeq };
      }
      case "object": {
        if (jsonableObject === null) {
          return { object: jsonableObject, seq: lowLevelDb.initialSeq };
        } else if (Array.isArray(jsonableObject)) {
          switch (jsonableObject[0]) {
            case "array": {
              const itemsDeserializeResults = await Promise.all(jsonableObject[1].map(async (o: any) => await deserializePiledriverObjectFromJsonableObject(o)));
              return { object: itemsDeserializeResults.map(r => r.object), seq: lowLevelDb.combineSeqs(...itemsDeserializeResults.map(r => r.seq)) };
            }
            case "heap-reference": {
              const heapObjAndSeq = await getHeapObjectByKey(decodeBase64(jsonableObject[1]).buffer);
              if (heapObjAndSeq.object === null) throw new Error(`Assertion error: Heap object with base64 key "${jsonableObject[1]}" not found`);
              return { object: heapObjAndSeq.object, seq: heapObjAndSeq.seq };
            }
            case "NaN": {
              return { object: NaN, seq: lowLevelDb.initialSeq };
            }
            case "Infinity": {
              return { object: Infinity, seq: lowLevelDb.initialSeq };
            }
            case "-Infinity": {
              return { object: -Infinity, seq: lowLevelDb.initialSeq };
            }
            case "-0": {
              return { object: -0, seq: lowLevelDb.initialSeq };
            }
            default: {
              throw new Error("Assertion error: Serialized Piledriver JSONable object array has unknown type " + jsonableObject[0]);
            }
          }
        } else {
          const entries = Object.entries(jsonableObject);
          const entriesDeserializeResults = await Promise.all(entries.map(async ([k, v]) => [k, await deserializePiledriverObjectFromJsonableObject(v)] as const));
          return {
            object: Object.fromEntries(entriesDeserializeResults.map(([k, v]) => [k, v.object] as const)),
            seq: lowLevelDb.combineSeqs(...entriesDeserializeResults.map(([_, v]) => v.seq)),
          };
        }
      }
      default: {
        throw new Error("Assertion error: Unknown type of serialized Piledriver JSONable object " + typeof jsonableObject);
      }
    }
  };

  const deserializePiledriverObject = async (buffer: ArrayBuffer): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> => {
    return await deserializePiledriverObjectFromJsonableObject(JSON.parse(new TextDecoder().decode(buffer)));
  };

  const parseDebugEntryValue = (valueUtf8: string | null) => {
    if (valueUtf8 === null) return null;
    try {
      return JSON.parse(valueUtf8);
    } catch {
      return valueUtf8;
    }
  };

  return {
    async getRootObject(key): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> {
      const { buffer, seq: rootSeq } = await rootStore.get(key);
      if (buffer === null) throw new Error("Root object not found");
      const { object, seq: deserializeSeq } = await deserializePiledriverObject(buffer);
      return { object, seq: lowLevelDb.combineSeqs(deserializeSeq, rootSeq) };
    },
    async setRootObject(key, value): Promise<{ seq: DatabaseSeq }> {
      const { buffer, seq } = await serializePiledriverObject(value);
      const { seq: rootSeq } = await rootStore.setAll([{ key, value: buffer }], { requiresSeq: seq });
      return { seq: rootSeq };
    },
    async deleteRootObject(key): Promise<{ seq: DatabaseSeq }> {
      const { seq } = await rootStore.deleteAll([key]);
      return { seq };
    },
    combineSeqs(...seqs) {
      return lowLevelDb.combineSeqs(...seqs);
    },
    waitUntilAvailable(seq) {
      return lowLevelDb.waitUntilAvailable(seq);
    },
    waitUntilDurable(seq) {
      return lowLevelDb.waitUntilDurable(seq);
    },
    waitUntilReplicated(seq) {
      return lowLevelDb.waitUntilReplicated(seq);
    },
    async debugSnapshot() {
      return {
        roots: (await rootStore.debugEntries?.() ?? []).map(entry => ({
          keyBase64: entry.keyBase64,
          keyUtf8: entry.keyUtf8,
          keyHex: entry.keyHex,
          serializedJson: parseDebugEntryValue(entry.valueUtf8),
          valueByteLength: entry.valueByteLength,
        })),
        heap: (await heapDump.debugEntries?.() ?? []).map(entry => ({
          keyBase64: entry.keyBase64,
          keyUtf8: entry.keyUtf8,
          keyHex: entry.keyHex,
          serializedJson: parseDebugEntryValue(entry.valueUtf8),
          valueByteLength: entry.valueByteLength,
        })),
      };
    },
    async debugLowLevelSnapshot() {
      return await lowLevelDb.debugSnapshot?.() ?? { stores: {}, dumps: {} };
    },
    initialSeq: lowLevelDb.initialSeq,
  };
}
