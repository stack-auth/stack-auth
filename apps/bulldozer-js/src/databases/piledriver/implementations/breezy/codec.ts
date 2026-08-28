/**
 * Piledriver's persisted wire codec.
 *
 * The tagged JSON representation is part of the database format, not merely an implementation
 * detail. Existing databases contain these values, so changing a tag or its shape requires an
 * explicit compatibility plan. Heap storage is deliberately injected through callbacks: this
 * module defines the format while the database implementation owns IO and sequence ordering.
 */
import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { isPiledriverHeapObjectSymbol, PiledriverHeapObject, PiledriverObject } from "../../index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const defineOwn = (object: object, key: string, value: unknown) => {
  // Assignment would invoke Object.prototype.__proto__ instead of restoring an own property.
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
};

/**
 * Decodes one stored value without loading referenced heap payloads.
 *
 * `resolveHeapObject` must return a lazy wrapper for a key. Keeping resolution synchronous here
 * ensures that reading a root only parses the root buffer; heap IO happens later through
 * `PiledriverHeapObject.get()`.
 */
export function decodePiledriverObject(
  buffer: ArrayBuffer,
  resolveHeapObject: (key: ArrayBuffer) => PiledriverHeapObject,
): PiledriverObject {
  const decode = (value: unknown): PiledriverObject => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      // Every real array is tagged, leaving singleton arrays available for special numeric values.
      const tag: unknown = value[0];
      const payload: unknown = value[1];
      if (tag === "array" && value.length === 2 && Array.isArray(payload)) return payload.map(decode);
      if (tag === "heap-reference" && value.length === 2 && typeof payload === "string") {
        return resolveHeapObject(decodeBase64(payload).buffer);
      }
      if (value.length === 1 && tag === "NaN") return NaN;
      if (value.length === 1 && tag === "Infinity") return Infinity;
      if (value.length === 1 && tag === "-Infinity") return -Infinity;
      if (value.length === 1 && tag === "-0") return -0;
      throw new Error("Assertion error: Invalid serialized Piledriver tagged value");
    }
    if (typeof value !== "object") throw new Error(`Assertion error: Invalid serialized Piledriver value: ${typeof value}`);
    const result: { [key: string]: PiledriverObject } = {};
    for (const [key, child] of Object.entries(value)) defineOwn(result, key, decode(child));
    return result;
  };

  return decode(JSON.parse(decoder.decode(buffer)));
}

/**
 * Encodes one value and reports every heap dependency encountered directly in that value.
 *
 * `Dependency` is intentionally opaque to the codec. The database uses it for causal sequence
 * tokens, but tests or other storage implementations may attach different dependency metadata.
 * The callback receives an immutable ancestor path so nested heap serialization can reject cycles
 * before it waits on an ancestor.
 */
export async function encodePiledriverObject<Dependency>(
  value: PiledriverObject,
  heapPath: ReadonlySet<PiledriverHeapObject>,
  resolveHeapObject: (
    object: PiledriverHeapObject,
    childHeapPath: ReadonlySet<PiledriverHeapObject>,
  ) => Promise<{ key: ArrayBuffer, dependency: Dependency }>,
): Promise<{ buffer: ArrayBuffer, dependencies: Dependency[] }> {
  const dependencies: Dependency[] = [];
  // Unlike heap objects, ordinary objects are serialized inline and only need path-local cycle detection.
  const objectPath = new Set<object>();
  const encode = async (node: PiledriverObject): Promise<unknown> => {
    if (typeof node === "number") {
      if (Number.isFinite(node) && !Object.is(node, -0)) return node;
      // JSON would otherwise collapse NaN/infinities to null and -0 to 0.
      return [Object.is(node, -0) ? "-0" : node.toString()];
    }
    if (node === null || typeof node === "string" || typeof node === "boolean") return node;
    if (isPiledriverHeapObjectSymbol in node) {
      if (heapPath.has(node)) throw new Error("Piledriver objects must not contain cycles (found a cycle of heap objects)");
      const resolved = await resolveHeapObject(node, new Set(heapPath).add(node));
      dependencies.push(resolved.dependency);
      return ["heap-reference", encodeBase64(new Uint8Array(resolved.key))];
    }
    if (objectPath.has(node)) throw new Error("Piledriver objects must not contain cycles");
    objectPath.add(node);
    let result: unknown;
    if (Array.isArray(node)) {
      const items: unknown[] = [];
      for (const item of node) items.push(await encode(item));
      result = ["array", items];
    } else {
      const object: { [key: string]: unknown } = {};
      for (const [key, child] of Object.entries(node)) defineOwn(object, key, await encode(child));
      result = object;
    }
    objectPath.delete(node);
    return result;
  };

  const jsonable = await encode(value);
  return { buffer: encoder.encode(JSON.stringify(jsonable)).buffer, dependencies };
}
