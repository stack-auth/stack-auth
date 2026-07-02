import { asHeapObject, isPiledriverHeapObjectSymbol, PiledriverHeapObject, PiledriverObject } from "../index.js";

type AsyncImmutableMap<K, V> = {
  get(key: K): Promise<V | undefined>,
  set(key: K, value: V): Promise<AsyncImmutableMap<K, V>>,
  delete(key: K): Promise<AsyncImmutableMap<K, V>>,
  has(key: K): Promise<boolean>,
  size(): Promise<number>,
  keys(): AsyncIterable<K>,
  values(): AsyncIterable<V>,
  entries(): AsyncIterable<[K, V]>,
};

type MaybePromise<T> = T | Promise<T>;
type Opt<K, V, A, I extends PiledriverObject = string> = {
  arity?: number,
  comparator: (a: K, b: K) => number,
  initialAugmentation?: A,
  extractAugmentation: (value: V, key: K, entryId: I) => MaybePromise<A>,
  mergeAugmentations: (...augmentations: A[]) => MaybePromise<A>,
};

// Internal marker for "no augmentation accumulated yet". A distinct sentinel (rather than
// null/undefined) is needed because null is a valid augmentation value.
const noAugmentation = Symbol("no-augmentation");
type NoAugmentation = typeof noAugmentation;
type Entry<K, V> = [K, V];
type Child<K, A> = { ref: PiledriverHeapObject, augmentation: A, size: number, entryCount: number, minKey: K, maxKey: K };
type Split<K, V, A> = { entry: Entry<K, V>, right: Child<K, A> };
// Persisted B-tree node. Children are heap objects, so unchanged subtrees are shared across versions.
type Node<K, V, A> = {
  entries: Entry<K, V>[],
  children: Child<K, A>[],
  augmentation: A,
  size: number,
  minKey: K,
  maxKey: K,
};
type EntryOptions<K> = {
  lte?: K,
  gte?: K,
  lt?: K,
  gt?: K,
  limit?: number,
  reverse?: boolean,
};
type AugmentedTreeMapObject = {
  type: "AugmentedTreeMap",
  root: Child<PiledriverObject, PiledriverObject> | null,
};
type MultiMapOptions<K, V, A, I extends PiledriverObject> = Opt<K, V, A, I> & {
  entryIdComparator?: (a: I, b: I) => number,
};
type MultiKey<K extends PiledriverObject, I extends PiledriverObject> = {
  [key: string]: PiledriverObject,
  key: K,
  id: I,
};
type AugmentedTreeMultiMapObject = {
  type: "AugmentedTreeMultiMap",
  tree: PiledriverObject,
};

const lowerEntryId = Symbol("lower-entry-id");
const upperEntryId = Symbol("upper-entry-id");
const mapEntryId = "";
const defaultArity = 32;

// Code-unit comparisons; localeCompare would persist a tree whose order depends on the runtime locale.
function compareStrings(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function defaultEntryIdComparator<I extends PiledriverObject>(a: I, b: I) {
  return compareStrings(JSON.stringify(a), JSON.stringify(b));
}

function mapOptions<K extends PiledriverObject, V extends PiledriverObject, A extends PiledriverObject>(options: Opt<K, V, A, string>): MultiMapOptions<K, V, A, string> {
  return {
    ...options,
    entryIdComparator: compareStrings,
  };
}

export class AugmentedTreeMultiMap<Key extends PiledriverObject, Value extends PiledriverObject, Augmentation extends PiledriverObject, EntryId extends PiledriverObject = string> {
  constructor(
    private readonly options: MultiMapOptions<Key, Value, Augmentation, EntryId>,
    private readonly root: Child<MultiKey<Key, EntryId>, Augmentation> | null = null,
  ) {}

  async size() {
    return this.root?.size ?? 0;
  }

  async getEntry(key: Key, entryId: EntryId): Promise<Value | undefined> {
    return await this.getRaw({ key, id: entryId });
  }

  async getAll(key: Key): Promise<Array<[EntryId, Value]>> {
    const result: Array<[EntryId, Value]> = [];
    for await (const [, entryId, value] of this.entries({ gte: key, lte: key })) {
      result.push([entryId, value]);
    }
    return result;
  }

  async add(key: Key, entryId: EntryId, value: Value) {
    return await this.insertRaw({ key, id: entryId }, value);
  }

  async set(key: Key, entryId: EntryId, value: Value) {
    return await this.setRaw({ key, id: entryId }, value);
  }

  async delete(key: Key, entryId: EntryId) {
    return await this.deleteRaw({ key, id: entryId });
  }

  async deleteAll(key: Key) {
    let result: AugmentedTreeMultiMap<Key, Value, Augmentation, EntryId> = this;
    for (const [entryId] of await this.getAll(key)) {
      result = await result.delete(key, entryId);
    }
    return result;
  }

  async *keys(options?: EntryOptions<Key>) {
    for await (const [key] of this.entries(options)) yield key;
  }

  async *values(options?: EntryOptions<Key>) {
    for await (const [, , value] of this.entries(options)) yield value;
  }

  async *entries(options: EntryOptions<Key> = {}): AsyncIterable<[Key, EntryId, Value]> {
    for await (const [multiKey, value] of this.rawEntries(this.indexRange(options))) {
      yield [multiKey.key, multiKey.id, value];
    }
  }

  async getAugmentation(range: { lte?: Key, gte?: Key, lt?: Key, gt?: Key }): Promise<Augmentation> {
    const result = await this.augmentation(this.root, this.indexRange(range));
    return result === noAugmentation ? await this.empty() : result;
  }

  toPiledriverObject(): AugmentedTreeMultiMapObject {
    return { type: "AugmentedTreeMultiMap", tree: this.toTreePiledriverObject() };
  }

  toTreePiledriverObject(): PiledriverObject {
    return { type: "AugmentedTreeMap", root: this.root };
  }

  static fromPiledriverObject<K extends PiledriverObject, V extends PiledriverObject, A extends PiledriverObject, I extends PiledriverObject = string>(object: PiledriverObject, options: MultiMapOptions<K, V, A, I>) {
    const serialized = object as Partial<AugmentedTreeMultiMapObject>;
    if (!object || typeof object !== "object" || Array.isArray(object) || serialized.type !== "AugmentedTreeMultiMap") {
      throw new Error("Invalid AugmentedTreeMultiMap object");
    }
    return AugmentedTreeMultiMap.fromTreePiledriverObject(serialized.tree!, options);
  }

  static fromTreePiledriverObject<K extends PiledriverObject, V extends PiledriverObject, A extends PiledriverObject, I extends PiledriverObject = string>(object: PiledriverObject, options: MultiMapOptions<K, V, A, I>) {
    const serialized = object as Partial<AugmentedTreeMapObject>;
    if (!object || typeof object !== "object" || Array.isArray(object) || serialized.type !== "AugmentedTreeMap") {
      throw new Error("Invalid AugmentedTreeMap object");
    }

    const root = serialized.root;
    if (root !== null && !AugmentedTreeMultiMap.isChild(root)) {
      throw new Error("Invalid AugmentedTreeMap root");
    }

    return new AugmentedTreeMultiMap(options, root as Child<MultiKey<K, I>, A> | null);
  }

  private async getRaw(key: MultiKey<Key, EntryId>): Promise<Value | undefined> {
    for (let node = await this.node(this.root?.ref ?? null); node;) {
      const { index, found } = this.search(node.entries, key);
      if (found) return node.entries[index][1];
      node = await this.node(node.children[index]?.ref ?? null);
    }
  }

  private async setRaw(key: MultiKey<Key, EntryId>, value: Value) {
    return new AugmentedTreeMultiMap(this.options, await this.finishUpsert(await this.upsert(this.root?.ref ?? null, key, value, true)));
  }

  private async insertRaw(key: MultiKey<Key, EntryId>, value: Value) {
    return new AugmentedTreeMultiMap(this.options, await this.finishUpsert(await this.upsert(this.root?.ref ?? null, key, value, false)));
  }

  private async deleteRaw(key: MultiKey<Key, EntryId>) {
    const { root, deleted } = await this.deleteFrom(this.root, key, true);
    return deleted ? new AugmentedTreeMultiMap(this.options, root) : this;
  }

  private async *rawEntries(options: EntryOptions<MultiKey<Key, EntryId>> = {}): AsyncIterable<[MultiKey<Key, EntryId>, Value]> {
    let yielded = 0;
    const isInRange = (key: MultiKey<Key, EntryId>) =>
      (options.gte === undefined || this.compareKeys(key, options.gte) >= 0)
      && (options.gt === undefined || this.compareKeys(key, options.gt) > 0)
      && (options.lte === undefined || this.compareKeys(key, options.lte) <= 0)
      && (options.lt === undefined || this.compareKeys(key, options.lt) < 0);

    const walk = async function* (tree: AugmentedTreeMultiMap<Key, Value, Augmentation, EntryId>, child: Child<MultiKey<Key, EntryId>, Augmentation> | null): AsyncIterable<Entry<MultiKey<Key, EntryId>, Value>> {
      if (!child || (options.limit !== undefined && yielded >= options.limit) || !tree.overlaps(child, options)) return;
      const node = (await tree.node(child.ref))!;

      const visitEntry = function* (entry: Entry<MultiKey<Key, EntryId>, Value>): Iterable<Entry<MultiKey<Key, EntryId>, Value>> {
        if (isInRange(entry[0]) && (options.limit === undefined || yielded++ < options.limit)) yield entry;
      };

      if (options.reverse) {
        for (let i = node.entries.length - 1; i >= 0; i--) {
          yield* walk(tree, node.children[i + 1] ?? null);
          yield* visitEntry(node.entries[i]);
        }
        yield* walk(tree, node.children[0] ?? null);
      } else {
        for (let i = 0; i < node.entries.length; i++) {
          yield* walk(tree, node.children[i] ?? null);
          yield* visitEntry(node.entries[i]);
        }
        yield* walk(tree, node.children[node.entries.length] ?? null);
      }
    };

    yield* walk(this, this.root);
  }

  private static isChild(value: PiledriverObject | undefined): value is Child<PiledriverObject, PiledriverObject> {
    if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const child = value as Partial<Child<PiledriverObject, PiledriverObject>>;
    return typeof child.size === "number"
      && typeof child.entryCount === "number"
      && "augmentation" in value
      && "minKey" in value
      && "maxKey" in value
      && child.ref !== undefined
      && typeof child.ref === "object"
      && !Array.isArray(child.ref)
      && isPiledriverHeapObjectSymbol in child.ref;
  }

  private async node(heapObject: PiledriverHeapObject | null) {
    return heapObject ? await heapObject.get() as Node<MultiKey<Key, EntryId>, Value, Augmentation> : null;
  }

  private async empty() {
    return this.options.initialAugmentation !== undefined ? this.options.initialAugmentation : await this.options.mergeAugmentations();
  }

  private async merge(a: Augmentation | NoAugmentation, b: Augmentation | NoAugmentation) {
    if (a === noAugmentation) return b;
    if (b === noAugmentation) return a;
    return await this.options.mergeAugmentations(a, b);
  }

  private child(ref: PiledriverHeapObject, node: Node<MultiKey<Key, EntryId>, Value, Augmentation>): Child<MultiKey<Key, EntryId>, Augmentation> {
    return {
      ref,
      augmentation: node.augmentation,
      size: node.size,
      entryCount: node.entries.length,
      minKey: node.minKey,
      maxKey: node.maxKey,
    };
  }

  // Recomputes all cached metadata for a freshly path-copied node.
  private async make(entries: Entry<MultiKey<Key, EntryId>, Value>[], children: Child<MultiKey<Key, EntryId>, Augmentation>[] = []) {
    if (!entries.length && children.length !== 1) throw new Error("Invalid empty B-tree node");
    if (!entries.length) {
      const [onlyChild] = children;
      const node = {
        entries,
        children,
        augmentation: onlyChild.augmentation,
        size: onlyChild.size,
        minKey: onlyChild.minKey,
        maxKey: onlyChild.maxKey,
      };
      return this.child(asHeapObject(node as PiledriverObject), node);
    }

    const augmentations: Augmentation[] = [];
    let size = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const child = children.at(i);
      if (child) {
        augmentations.push(child.augmentation);
        size += child.size;
      }
      augmentations.push(await this.options.extractAugmentation(entries[i][1], entries[i][0].key, entries[i][0].id));
    }
    const lastChild = children.at(entries.length);
    if (lastChild) {
      augmentations.push(lastChild.augmentation);
      size += lastChild.size;
    }

    const node = {
      entries,
      children,
      augmentation: await this.options.mergeAugmentations(...augmentations),
      size,
      minKey: children[0]?.minKey ?? entries[0][0],
      maxKey: children[children.length - 1]?.maxKey ?? entries[entries.length - 1][0],
    };
    return this.child(asHeapObject(node as PiledriverObject), node);
  }

  private arity() {
    return Math.max(3, this.options.arity ?? defaultArity);
  }

  private maxEntries() {
    return this.arity() - 1;
  }

  private minEntries() {
    return Math.floor(this.maxEntries() / 2);
  }

  private search(entries: Entry<MultiKey<Key, EntryId>, Value>[], key: MultiKey<Key, EntryId>) {
    let low = 0, high = entries.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.compareKeys(entries[mid][0], key) < 0) low = mid + 1;
      else high = mid;
    }
    return { index: low, found: low < entries.length && this.compareKeys(entries[low][0], key) === 0 };
  }

  private async finishUpsert(result: { root: Child<MultiKey<Key, EntryId>, Augmentation>, split?: Split<MultiKey<Key, EntryId>, Value, Augmentation> }) {
    return result.split ? await this.make([result.split.entry], [result.root, result.split.right]) : result.root;
  }

  private async split(entries: Entry<MultiKey<Key, EntryId>, Value>[], children: Child<MultiKey<Key, EntryId>, Augmentation>[]) {
    const middle = entries.length >> 1;
    const left = await this.make(entries.slice(0, middle), children.length ? children.slice(0, middle + 1) : []);
    const right = await this.make(entries.slice(middle + 1), children.length ? children.slice(middle + 1) : []);
    return { root: left, split: { entry: entries[middle], right } };
  }

  private async done(entries: Entry<MultiKey<Key, EntryId>, Value>[], children: Child<MultiKey<Key, EntryId>, Augmentation>[], added: boolean) {
    const result = entries.length > this.maxEntries() ? await this.split(entries, children) : { root: await this.make(entries, children) };
    return { ...result, added };
  }

  private async upsert(heapObject: PiledriverHeapObject | null, key: MultiKey<Key, EntryId>, value: Value, replace: boolean): Promise<{ root: Child<MultiKey<Key, EntryId>, Augmentation>, split?: Split<MultiKey<Key, EntryId>, Value, Augmentation>, added: boolean }> {
    const node = await this.node(heapObject);
    if (!node) return { root: await this.make([[key, value]]), added: true };

    const { index, found } = this.search(node.entries, key);
    const entries = [...node.entries];
    const children = [...node.children];

    if (found) {
      if (!replace) throw new Error("Key already exists");
      entries[index] = [key, value];
      return await this.done(entries, children, false);
    }

    if (!children.length) {
      entries.splice(index, 0, [key, value]);
      return await this.done(entries, children, true);
    }

    const child = await this.upsert(children[index].ref, key, value, replace);
    children[index] = child.root;
    if (child.split) {
      entries.splice(index, 0, child.split.entry);
      children.splice(index + 1, 0, child.split.right);
    }
    return await this.done(entries, children, child.added);
  }

  private async deleteFrom(child: Child<MultiKey<Key, EntryId>, Augmentation> | null, key: MultiKey<Key, EntryId>, isRoot = false): Promise<{ root: Child<MultiKey<Key, EntryId>, Augmentation> | null, deleted: boolean }> {
    if (!child) return { root: null, deleted: false };

    const node = (await this.node(child.ref))!;
    const { index, found } = this.search(node.entries, key);
    const entries = [...node.entries];
    const children = [...node.children] as (Child<MultiKey<Key, EntryId>, Augmentation> | null)[];

    if (found) {
      if (!children.length) {
        entries.splice(index, 1);
        return await this.afterDelete(entries, children, isRoot, true);
      }

      // Replace the separator with its predecessor or successor (from whichever side has more
      // slack), then rebalance that child if it underflowed. Never pre-merge two minimally
      // filled children: the result would have 2 * minEntries + 1 entries, which overflows
      // maxEntries when maxEntries is even.
      const left = children[index]!;
      const right = children[index + 1]!;
      if (right.entryCount > left.entryCount) {
        const { root, entry } = await this.deleteMin(right);
        entries[index] = entry;
        children[index + 1] = root;
        return await this.fixChild(entries, children, index + 1, isRoot);
      }
      const { root, entry } = await this.deleteMax(left);
      entries[index] = entry;
      children[index] = root;
      return await this.fixChild(entries, children, index, isRoot);
    }

    if (!children.length) return { root: child, deleted: false };

    const deletedChild = await this.deleteFrom(children[index], key);
    if (!deletedChild.deleted) return { root: child, deleted: false };
    children[index] = deletedChild.root;
    return await this.fixChild(entries, children, index, isRoot);
  }

  private async deleteMin(child: Child<MultiKey<Key, EntryId>, Augmentation>): Promise<{ root: Child<MultiKey<Key, EntryId>, Augmentation> | null, entry: Entry<MultiKey<Key, EntryId>, Value> }> {
    const node = (await this.node(child.ref))!;
    const entries = [...node.entries];
    const children = [...node.children] as (Child<MultiKey<Key, EntryId>, Augmentation> | null)[];

    if (!children.length) {
      const [entry] = entries.splice(0, 1);
      return { root: entries.length ? await this.make(entries) : null, entry };
    }

    const result = await this.deleteMin(children[0]!);
    children[0] = result.root;
    return { root: (await this.fixChild(entries, children, 0, false)).root, entry: result.entry };
  }

  private async deleteMax(child: Child<MultiKey<Key, EntryId>, Augmentation>): Promise<{ root: Child<MultiKey<Key, EntryId>, Augmentation> | null, entry: Entry<MultiKey<Key, EntryId>, Value> }> {
    const node = (await this.node(child.ref))!;
    const entries = [...node.entries];
    const children = [...node.children] as (Child<MultiKey<Key, EntryId>, Augmentation> | null)[];

    if (!children.length) {
      const entry = entries.pop()!;
      return { root: entries.length ? await this.make(entries) : null, entry };
    }

    const index = children.length - 1;
    const result = await this.deleteMax(children[index]!);
    children[index] = result.root;
    return { root: (await this.fixChild(entries, children, index, false)).root, entry: result.entry };
  }

  private async afterDelete(entries: Entry<MultiKey<Key, EntryId>, Value>[], children: (Child<MultiKey<Key, EntryId>, Augmentation> | null)[], isRoot: boolean, deleted: boolean) {
    const liveChildren = children.filter(child => child !== null);
    if (!entries.length) return { root: isRoot ? liveChildren[0] ?? null : liveChildren[0] ? await this.make([], [liveChildren[0]]) : null, deleted };
    return { root: await this.make(entries, liveChildren), deleted };
  }

  private async fixChild(entries: Entry<MultiKey<Key, EntryId>, Value>[], children: (Child<MultiKey<Key, EntryId>, Augmentation> | null)[], index: number, isRoot: boolean): Promise<{ root: Child<MultiKey<Key, EntryId>, Augmentation> | null, deleted: boolean }> {
    const child = children[index];
    if (child && child.entryCount >= this.minEntries()) return await this.afterDelete(entries, children, isRoot, true);

    const left = children[index - 1];
    if (left && left.entryCount > this.minEntries()) {
      const leftNode = (await this.node(left.ref))!;
      const childNode = child ? (await this.node(child.ref))! : { entries: [], children: [] };
      const separator = entries[index - 1];
      const borrowedEntry = leftNode.entries[leftNode.entries.length - 1];
      const borrowedChild = leftNode.children.at(-1);
      entries[index - 1] = borrowedEntry;
      children[index - 1] = await this.make(leftNode.entries.slice(0, -1), leftNode.children.slice(0, -1));
      children[index] = await this.make([separator, ...childNode.entries], borrowedChild === undefined ? childNode.children : [borrowedChild, ...childNode.children]);
      return await this.afterDelete(entries, children, isRoot, true);
    }

    const right = children[index + 1];
    if (right && right.entryCount > this.minEntries()) {
      const childNode = child ? (await this.node(child.ref))! : { entries: [], children: [] };
      const rightNode = (await this.node(right.ref))!;
      const separator = entries[index];
      const borrowedEntry = rightNode.entries[0];
      const borrowedChild = rightNode.children.at(0);
      entries[index] = borrowedEntry;
      children[index] = await this.make([...childNode.entries, separator], borrowedChild === undefined ? childNode.children : [...childNode.children, borrowedChild]);
      children[index + 1] = await this.make(rightNode.entries.slice(1), rightNode.children.slice(1));
      return await this.afterDelete(entries, children, isRoot, true);
    }

    const mergeIndex = left ? index - 1 : index;
    const merged = await this.mergeChildren(children[mergeIndex], entries[mergeIndex], children[mergeIndex + 1]);
    entries.splice(mergeIndex, 1);
    children.splice(mergeIndex, 2, merged);
    return await this.afterDelete(entries, children, isRoot, true);
  }

  private async mergeChildren(left: Child<MultiKey<Key, EntryId>, Augmentation> | null, entry: Entry<MultiKey<Key, EntryId>, Value>, right: Child<MultiKey<Key, EntryId>, Augmentation> | null) {
    const leftNode = left ? (await this.node(left.ref))! : { entries: [], children: [] };
    const rightNode = right ? (await this.node(right.ref))! : { entries: [], children: [] };
    return await this.make(
      [...leftNode.entries, entry, ...rightNode.entries],
      [...leftNode.children, ...rightNode.children],
    );
  }

  private async augmentation(child: Child<MultiKey<Key, EntryId>, Augmentation> | null, range: { lte?: MultiKey<Key, EntryId>, gte?: MultiKey<Key, EntryId>, lt?: MultiKey<Key, EntryId>, gt?: MultiKey<Key, EntryId> }): Promise<Augmentation | NoAugmentation> {
    if (!child || !this.overlaps(child, range)) return noAugmentation;

    const aboveLowerBound = (key: MultiKey<Key, EntryId>) =>
      (range.gte === undefined || this.compareKeys(key, range.gte) >= 0)
      && (range.gt === undefined || this.compareKeys(key, range.gt) > 0);
    const belowUpperBound = (key: MultiKey<Key, EntryId>) =>
      (range.lte === undefined || this.compareKeys(key, range.lte) <= 0)
      && (range.lt === undefined || this.compareKeys(key, range.lt) < 0);

    // min/max let us use a whole subtree's cached augmentation without reading descendants.
    if (aboveLowerBound(child.minKey) && belowUpperBound(child.maxKey)) return child.augmentation;

    const node = (await this.node(child.ref))!;
    let result: Augmentation | NoAugmentation = noAugmentation;
    for (let i = 0; i < node.entries.length; i++) {
      result = await this.merge(result, await this.augmentation(node.children[i] ?? null, range));
      if (aboveLowerBound(node.entries[i][0]) && belowUpperBound(node.entries[i][0])) {
        result = await this.merge(result, await this.options.extractAugmentation(node.entries[i][1], node.entries[i][0].key, node.entries[i][0].id));
      }
    }
    return await this.merge(result, await this.augmentation(node.children[node.entries.length] ?? null, range));
  }

  private overlaps(summary: { minKey: MultiKey<Key, EntryId>, maxKey: MultiKey<Key, EntryId> }, range: { lte?: MultiKey<Key, EntryId>, gte?: MultiKey<Key, EntryId>, lt?: MultiKey<Key, EntryId>, gt?: MultiKey<Key, EntryId> }) {
    return (range.gte === undefined || this.compareKeys(summary.maxKey, range.gte) >= 0)
      && (range.gt === undefined || this.compareKeys(summary.maxKey, range.gt) > 0)
      && (range.lte === undefined || this.compareKeys(summary.minKey, range.lte) <= 0)
      && (range.lt === undefined || this.compareKeys(summary.minKey, range.lt) < 0);
  }

  private compareEntryIds(a: EntryId | typeof lowerEntryId | typeof upperEntryId, b: EntryId | typeof lowerEntryId | typeof upperEntryId) {
    if (a === b) return 0;
    if (a === lowerEntryId || b === upperEntryId) return -1;
    if (a === upperEntryId || b === lowerEntryId) return 1;
    return (this.options.entryIdComparator ?? defaultEntryIdComparator)(a, b);
  }

  private compareKeys(a: MultiKey<Key, EntryId>, b: MultiKey<Key, EntryId>) {
    const keyComparison = this.options.comparator(a.key, b.key);
    return keyComparison || this.compareEntryIds(a.id, b.id);
  }

  private indexRange(range: { lte?: Key, gte?: Key, lt?: Key, gt?: Key, limit?: number, reverse?: boolean }) {
    return {
      ...range,
      gte: range.gte === undefined ? undefined : { key: range.gte, id: lowerEntryId } as unknown as MultiKey<Key, EntryId>,
      gt: range.gt === undefined ? undefined : { key: range.gt, id: upperEntryId } as unknown as MultiKey<Key, EntryId>,
      lte: range.lte === undefined ? undefined : { key: range.lte, id: upperEntryId } as unknown as MultiKey<Key, EntryId>,
      lt: range.lt === undefined ? undefined : { key: range.lt, id: lowerEntryId } as unknown as MultiKey<Key, EntryId>,
      limit: range.limit,
      reverse: range.reverse,
    };
  }
}

export class AugmentedTreeMap<K extends PiledriverObject, V extends PiledriverObject, A extends PiledriverObject> implements AsyncImmutableMap<K, V> {
  constructor(
    private readonly options: Opt<K, V, A, string>,
    root: Child<PiledriverObject, PiledriverObject> | null = null,
    private readonly multiMap = root
      ? AugmentedTreeMultiMap.fromTreePiledriverObject({ type: "AugmentedTreeMap", root }, mapOptions(options))
      : new AugmentedTreeMultiMap(mapOptions(options)),
  ) {}

  async size() {
    return await this.multiMap.size();
  }

  async has(key: K) {
    return await this.get(key) !== undefined;
  }

  async get(key: K): Promise<V | undefined> {
    return await this.multiMap.getEntry(key, mapEntryId);
  }

  async set(key: K, value: V) {
    return new AugmentedTreeMap(this.options, null, await this.multiMap.set(key, mapEntryId, value));
  }

  async insert(key: K, value: V) {
    return new AugmentedTreeMap(this.options, null, await this.multiMap.add(key, mapEntryId, value));
  }

  async delete(key: K) {
    return new AugmentedTreeMap(this.options, null, await this.multiMap.delete(key, mapEntryId));
  }

  async *keys(options?: EntryOptions<K>) {
    for await (const [key] of this.entries(options)) yield key;
  }

  async *values(options?: EntryOptions<K>) {
    for await (const [, value] of this.entries(options)) yield value;
  }

  async *entries(options?: EntryOptions<K>): AsyncIterable<[K, V]> {
    for await (const [key, , value] of this.multiMap.entries(options)) {
      yield [key, value];
    }
  }

  async getAugmentation(range: { lte?: K, gte?: K, lt?: K, gt?: K }): Promise<A> {
    return await this.multiMap.getAugmentation(range);
  }

  toPiledriverObject(): AugmentedTreeMapObject {
    return this.multiMap.toTreePiledriverObject() as AugmentedTreeMapObject;
  }

  static fromPiledriverObject<K extends PiledriverObject, V extends PiledriverObject, A extends PiledriverObject>(object: PiledriverObject, options: Opt<K, V, A, string>) {
    const multiMap = AugmentedTreeMultiMap.fromTreePiledriverObject(object, mapOptions(options));
    return new AugmentedTreeMap(options, null, multiMap);
  }
}
