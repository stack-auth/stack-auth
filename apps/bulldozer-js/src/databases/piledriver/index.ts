import { Database, DatabaseSeq } from "../index.js";
import type { LowLevelDatabaseDebugSnapshot } from "../low-level/index.js";
import type { PiledriverGarbageCollectionResult } from "./gc.js";

export const isPiledriverHeapObjectSymbol = Symbol.for("hexclave-piledriver-heap-object-symbol");
export type PiledriverHeapObjectLocalValue =
  | { status: "locally-created", value: PiledriverObject }
  | { status: "database-reference" };
export type PiledriverHeapObject = {
  get(): Promise<PiledriverObject>,
  getValueIfLocallyCreated(): PiledriverHeapObjectLocalValue,
  [isPiledriverHeapObjectSymbol]: true,
};

const heapObjectsMapNullSentinel = { __heapObjectsMapNullSentinel: true };
export const heapObjectsByObject = new WeakMap<PiledriverObject & object, PiledriverHeapObject>();

// TODO: Make heap-object creation database-scoped and brand both locally created and loaded
// references with their owning Piledriver database. Passing a heap object between databases should
// fail at the API boundary instead of implicitly loading and copying a foreign database reference.
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

  const localValue: PiledriverHeapObjectLocalValue = { status: "locally-created", value: obj };
  const res: PiledriverHeapObject = {
    async get() {
      return obj;
    },
    getValueIfLocallyCreated() {
      return localValue;
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
  getGarbageCollectionProcessStartedAtMillis(): number,
  collectGarbage(cutoffTimestampMillis: number, maxObjects?: number): Promise<PiledriverGarbageCollectionResult>,
  debugSnapshot?(): Promise<PiledriverDatabaseDebugSnapshot>,
  debugLowLevelSnapshot?(): Promise<LowLevelDatabaseDebugSnapshot>,
};

export type PiledriverDatabaseDebugSnapshot = {
  roots: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
  heap: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
};
