import { Result } from "./results";

export class WeakRefIfAvailable<T extends object> {
  private readonly _ref: { deref: () => T | undefined };

  constructor(value: T) {
    if (typeof WeakRef === "undefined") {
      this._ref = { deref: () => value };
    } else {
      this._ref = new WeakRef<T>(value);
    }
  }

  deref(): T | undefined {
    return this._ref.deref();
  }
}
import.meta.vitest?.test("WeakRefIfAvailable", ({ expect }) => {
  // Test with an object
  const obj = { id: 1, name: "test" };
  const weakRef = new WeakRefIfAvailable(obj);

  // Test deref returns the original object
  expect(weakRef.deref()).toBe(obj);

  // Test with a different object
  const obj2 = { id: 2, name: "test2" };
  const weakRef2 = new WeakRefIfAvailable(obj2);
  expect(weakRef2.deref()).toBe(obj2);
  expect(weakRef2.deref()).not.toBe(obj);

  // We can't easily test garbage collection in this environment,
  // but we can verify the basic functionality works
});


/**
 * A WeakMap-like object that can be iterated over.
 *
 * Note that it relies on WeakRef, and always falls back to the regular Map behavior (ie. no GC) in browsers that don't support it.
 */
export class IterableWeakMap<K extends object, V> {
  private readonly _weakMap: WeakMap<K & WeakKey, { value: V, keyRef: WeakRefIfAvailable<K & WeakKey> }>;
  private readonly _keyRefs: Set<WeakRefIfAvailable<K & WeakKey>>;

  constructor(entries?: readonly (readonly [K, V])[] | null) {
    const mappedEntries = entries?.map((e) => [e[0], { value: e[1], keyRef: new WeakRefIfAvailable(e[0]) }] as const);
    this._weakMap = new WeakMap(mappedEntries ?? []);
    this._keyRefs = new Set(mappedEntries?.map((e) => e[1].keyRef) ?? []);
  }

  get(key: K): V | undefined {
    return this._weakMap.get(key)?.value;
  }

  set(key: K, value: V): this {
    const existing = this._weakMap.get(key);
    const updated = { value, keyRef: existing?.keyRef ?? new WeakRefIfAvailable(key) };
    this._weakMap.set(key, updated);
    this._keyRefs.add(updated.keyRef);
    return this;
  }

  delete(key: K): boolean {
    const res = this._weakMap.get(key);
    if (res) {
      this._weakMap.delete(key);
      this._keyRefs.delete(res.keyRef);
      return true;
    }
    return false;
  }

  has(key: K): boolean {
    return this._weakMap.has(key) && this._keyRefs.has(this._weakMap.get(key)!.keyRef);
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    for (const keyRef of this._keyRefs) {
      const key = keyRef.deref();
      const existing = key ? this._weakMap.get(key) : undefined;
      if (!key) {
        // This can happen if the key was GCed. Remove it so the next iteration is faster.
        this._keyRefs.delete(keyRef);
      } else if (existing) {
        yield [key, existing.value];
      }
    }
  }

  [Symbol.toStringTag] = "IterableWeakMap";
}
import.meta.vitest?.test("IterableWeakMap", ({ expect }) => {
  // Test basic functionality
  const map = new IterableWeakMap<{ id: number }, string>();

  // Create object keys
  const obj1 = { id: 1 };
  const obj2 = { id: 2 };

  // Test set and get
  map.set(obj1, "value1");
  expect(map.get(obj1)).toBe("value1");

  // Test has
  expect(map.has(obj1)).toBe(true);
  expect(map.has(obj2)).toBe(false);
  expect(map.has({ id: 1 })).toBe(false); // Different object with same content

  // Test with multiple keys
  map.set(obj2, "value2");
  expect(map.get(obj2)).toBe("value2");
  expect(map.get(obj1)).toBe("value1"); // Original still exists

  // Test delete
  expect(map.delete(obj1)).toBe(true);
  expect(map.has(obj1)).toBe(false);
  expect(map.get(obj1)).toBeUndefined();
  expect(map.has(obj2)).toBe(true); // Other key still exists

  // Test delete non-existent key
  expect(map.delete({ id: 3 })).toBe(false);

  // Test iteration
  const iterMap = new IterableWeakMap<{ id: number }, number>();
  const iterObj1 = { id: 1 };
  const iterObj2 = { id: 2 };
  const iterObj3 = { id: 3 };

  iterMap.set(iterObj1, 1);
  iterMap.set(iterObj2, 2);
  iterMap.set(iterObj3, 3);

  const entries = Array.from(iterMap);
  expect(entries.length).toBe(3);

  // Find entries by their values since we can't directly compare objects in the array
  const values = entries.map(entry => entry[1]);
  expect(values).toContain(1);
  expect(values).toContain(2);
  expect(values).toContain(3);

  // Test constructor with entries
  const initialEntries: [{ id: number }, string][] = [
    [{ id: 4 }, "initial1"],
    [{ id: 5 }, "initial2"]
  ];
  const mapWithEntries = new IterableWeakMap(initialEntries);

  // We can't directly access the initial entries since they're different object references
  // But we can verify the map has the correct number of entries
  const entriesFromConstructor = Array.from(mapWithEntries);
  expect(entriesFromConstructor.length).toBe(2);
});

/**
 * A map that is a IterableWeakMap for object keys and a regular Map for primitive keys. Also provides iteration over both
 * object and primitive keys.
 *
 * Note that, just like IterableWeakMap, older browsers without support for WeakRef will use a regular Map for object keys.
 */
export class MaybeWeakMap<K, V> {
  private readonly _primitiveMap: Map<K, V>;
  private readonly _weakMap: IterableWeakMap<K & WeakKey, V>;

  constructor(entries?: readonly (readonly [K, V])[] | null) {
    const entriesArray = [...entries ?? []];
    this._primitiveMap = new Map(entriesArray.filter((e) => !this._isAllowedInWeakMap(e[0])));
    this._weakMap = new IterableWeakMap(entriesArray.filter((e): e is [K & WeakKey, V] => this._isAllowedInWeakMap(e[0])));
  }

  private _isAllowedInWeakMap(key: K): key is K & WeakKey {
    return (typeof key === "object" && key !== null) || (typeof key === "symbol" && Symbol.keyFor(key) === undefined);
  }

  get(key: K): V | undefined {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.get(key);
    } else {
      return this._primitiveMap.get(key);
    }
  }

  set(key: K, value: V): this {
    if (this._isAllowedInWeakMap(key)) {
      this._weakMap.set(key, value);
    } else {
      this._primitiveMap.set(key, value);
    }
    return this;
  }

  delete(key: K): boolean {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.delete(key);
    } else {
      return this._primitiveMap.delete(key);
    }
  }

  has(key: K): boolean {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.has(key);
    } else {
      return this._primitiveMap.has(key);
    }
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this._primitiveMap;
    yield* this._weakMap;
  }

  [Symbol.toStringTag] = "MaybeWeakMap";
}
import.meta.vitest?.test("MaybeWeakMap", ({ expect }) => {
  // Test with primitive keys
  const map = new MaybeWeakMap<string | object, number>();

  // Test with string keys
  map.set("key1", 1);
  map.set("key2", 2);
  expect(map.get("key1")).toBe(1);
  expect(map.get("key2")).toBe(2);
  expect(map.has("key1")).toBe(true);
  expect(map.has("nonexistent")).toBe(false);

  // Test with object keys
  const obj1 = { id: 1 };
  const obj2 = { id: 2 };
  map.set(obj1, 3);
  map.set(obj2, 4);
  expect(map.get(obj1)).toBe(3);
  expect(map.get(obj2)).toBe(4);
  expect(map.has(obj1)).toBe(true);

  // Test delete with primitive key
  expect(map.delete("key1")).toBe(true);
  expect(map.has("key1")).toBe(false);
  expect(map.delete("nonexistent")).toBe(false);

  // Test delete with object key
  expect(map.delete(obj1)).toBe(true);
  expect(map.has(obj1)).toBe(false);

  // Test iteration
  const entries = Array.from(map);
  expect(entries.length).toBe(2);
  expect(entries).toContainEqual(["key2", 2]);
  expect(entries).toContainEqual([obj2, 4]);

  // Test constructor with entries
  const initialEntries: [string | object, number][] = [
    ["initial1", 10],
    [{ id: 3 }, 20]
  ];
  const mapWithEntries = new MaybeWeakMap(initialEntries);
  expect(mapWithEntries.get("initial1")).toBe(10);
  expect(mapWithEntries.get(initialEntries[1][0])).toBe(20);
});


type DependenciesMapInner<V> = (
  & { map: MaybeWeakMap<unknown, DependenciesMapInner<V>> }
  & (
    | { hasValue: true, value: V }
    | { hasValue: false, value: undefined }
  )
);

/**
 * A map that stores values indexed by an array of keys. If the keys are objects and the environment supports WeakRefs,
 * they are stored in a WeakMap.
 */
export class DependenciesMap<K extends any[], V> {
  private _inner: DependenciesMapInner<V> = { map: new MaybeWeakMap(), hasValue: false, value: undefined };

  private _valueToResult(inner: DependenciesMapInner<V>): Result<V, void> {
    if (inner.hasValue) {
      return Result.ok(inner.value);
    } else {
      return Result.error(undefined);
    }
  }


  private _unwrapFromInner(dependencies: any[], inner: DependenciesMapInner<V>): Result<V, void> {
    if ((dependencies.length === 0)) {
      return this._valueToResult(inner);
    } else {
      const [key, ...rest] = dependencies;
      const newInner = inner.map.get(key);
      if (!newInner) {
        return Result.error(undefined);
      }
      return this._unwrapFromInner(rest, newInner);
    }
  }

  private _setInInner(dependencies: any[], value: Result<V, void>, inner: DependenciesMapInner<V>): Result<V, void> {
    if (dependencies.length === 0) {
      const res = this._valueToResult(inner);
      if (value.status === "ok") {
        inner.hasValue = true;
        inner.value = value.data;
      } else {
        inner.hasValue = false;
        inner.value = undefined;
      }
      return res;
    } else {
      const [key, ...rest] = dependencies;
      let newInner = inner.map.get(key);
      if (!newInner) {
        inner.map.set(key, newInner = { map: new MaybeWeakMap(), hasValue: false, value: undefined });
      }
      return this._setInInner(rest, value, newInner);
    }
  }

  private *_iterateInner(dependencies: any[], inner: DependenciesMapInner<V>): IterableIterator<[K, V]> {
    if (inner.hasValue) {
      yield [dependencies as K, inner.value];
    }
    for (const [key, value] of inner.map) {
      yield* this._iterateInner([...dependencies, key], value);
    }
  }

  get(dependencies: K): V | undefined {
    return Result.or(this._unwrapFromInner(dependencies, this._inner), undefined);
  }

  set(dependencies: K, value: V): this {
    this._setInInner(dependencies, Result.ok(value), this._inner);
    return this;
  }

  delete(dependencies: K): boolean {
    return this._setInInner(dependencies, Result.error(undefined), this._inner).status === "ok";
  }

  has(dependencies: K): boolean {
    return this._unwrapFromInner(dependencies, this._inner).status === "ok";
  }

  clear(): void {
    this._inner = { map: new MaybeWeakMap(), hasValue: false, value: undefined };
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this._iterateInner([], this._inner);
  }

  [Symbol.toStringTag] = "DependenciesMap";
}
import.meta.vitest?.test("DependenciesMap", ({ expect }) => {
  // Test basic functionality
  const map = new DependenciesMap<[string, number], string>();

  // Test set and get
  map.set(["key", 1], "value1");
  expect(map.get(["key", 1])).toBe("value1");

  // Test has
  expect(map.has(["key", 1])).toBe(true);
  expect(map.has(["key", 2])).toBe(false);

  // Test with different dependencies
  map.set(["key", 2], "value2");
  expect(map.get(["key", 2])).toBe("value2");
  expect(map.get(["key", 1])).toBe("value1"); // Original still exists

  // Test delete
  expect(map.delete(["key", 1])).toBe(true);
  expect(map.has(["key", 1])).toBe(false);
  expect(map.get(["key", 1])).toBeUndefined();
  expect(map.has(["key", 2])).toBe(true); // Other key still exists

  // Test delete non-existent key
  expect(map.delete(["nonexistent", 1])).toBe(false);

  // Test clear
  map.clear();
  expect(map.has(["key", 2])).toBe(false);

  // Test with object keys
  const objMap = new DependenciesMap<[object, number], string>();
  const obj1 = { id: 1 };
  const obj2 = { id: 2 };
  objMap.set([obj1, 1], "object1");
  objMap.set([obj2, 2], "object2");
  expect(objMap.get([obj1, 1])).toBe("object1");
  expect(objMap.get([obj2, 2])).toBe("object2");

  // Test iteration
  const iterMap = new DependenciesMap<[string], number>();
  iterMap.set(["a"], 1);
  iterMap.set(["b"], 2);
  iterMap.set(["c"], 3);

  const entries = Array.from(iterMap);
  expect(entries.length).toBe(3);
  expect(entries).toContainEqual([["a"], 1]);
  expect(entries).toContainEqual([["b"], 2]);
  expect(entries).toContainEqual([["c"], 3]);
});
