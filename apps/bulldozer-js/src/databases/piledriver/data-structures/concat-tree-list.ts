import { asHeapObject, isPiledriverHeapObjectSymbol, PiledriverHeapObject, piledriverObjectEquals, PiledriverObject } from "../index.js";

type Child = {
  ref: PiledriverHeapObject,
  size: number,
};
type Entry<T extends PiledriverObject> = [id: string, value: T];
type Node<T extends PiledriverObject> =
  | { type: "leaf", entries: Entry<T>[] }
  | { type: "node", children: Child[] };
type ConcatTreeListObject = {
  type: "ConcatTreeList",
  root: Child | null,
};
type ConcatTreeListBoundaryOptions<T extends PiledriverObject> = {
  arity?: number,
  mergeBoundary: (leftLast: T, rightFirst: T) => Iterable<T>,
};
type Segment = {
  child: Child,
  start: number,
  length: number,
  baseIndex: number,
};
export type ConcatTreeListDiff<T extends PiledriverObject> = {
  missing: { id: string, value: T }[],
  added: { id: string, value: T }[],
};

const defaultArity = 32;

export class ConcatTreeList<T extends PiledriverObject> implements AsyncIterable<T> {
  constructor(
    private readonly root: Child | null = null,
    private readonly options: { arity?: number } = {},
  ) {}

  static empty<T extends PiledriverObject>(options: { arity?: number } = {}) {
    return new ConcatTreeList<T>(null, options);
  }

  static from<T extends PiledriverObject>(values: Iterable<T>, options: { arity?: number } = {}) {
    return ConcatTreeList.fromEntries([...values].map(value => [crypto.randomUUID(), value]), options);
  }

  static fromEntries<T extends PiledriverObject>(entries: Iterable<Entry<T>>, options: { arity?: number } = {}) {
    const items = [...entries];
    return new ConcatTreeList<T>(items.length ? ConcatTreeList.child({ type: "leaf", entries: items }) : null, options);
  }

  static concat<T extends PiledriverObject>(lists: Iterable<ConcatTreeList<T>>, options: { arity?: number } = {}): ConcatTreeList<T> {
    return ConcatTreeList.fromChildren([...lists].flatMap(list => list.root ? [list.root] : []), options);
  }

  static async diff<T extends PiledriverObject>(left: ConcatTreeList<T>, right: ConcatTreeList<T>): Promise<ConcatTreeListDiff<T>> {
    const diff: ConcatTreeListDiff<T> = { missing: [], added: [] };
    await ConcatTreeList.diffRanges(
      left.root && { child: left.root, start: 0, length: left.root.size, baseIndex: 0 },
      right.root && { child: right.root, start: 0, length: right.root.size, baseIndex: 0 },
      diff,
    );
    return diff;
  }

  async size() {
    return this.root?.size ?? 0;
  }

  async get(index: number): Promise<T | undefined> {
    if (!this.root || index < 0 || index >= this.root.size) return undefined;
    return await this.getFrom(this.root, index);
  }

  async *entries(options: { reverse?: boolean } = {}): AsyncIterable<Entry<T>> {
    yield* this.walkEntries(this.root, options.reverse ?? false);
  }

  async *values(options: { reverse?: boolean } = {}): AsyncIterable<T> {
    for await (const [, value] of this.entries(options)) yield value;
  }

  [Symbol.asyncIterator]() {
    return this.values()[Symbol.asyncIterator]();
  }

  toPiledriverObject(): ConcatTreeListObject {
    return { type: "ConcatTreeList", root: this.root };
  }

  static fromPiledriverObject<T extends PiledriverObject>(object: PiledriverObject, options: { arity?: number } = {}) {
    const serialized = object as Partial<ConcatTreeListObject>;
    if (!object || typeof object !== "object" || Array.isArray(object) || serialized.type !== "ConcatTreeList") {
      throw new Error("Invalid ConcatTreeList object");
    }
    if (serialized.root !== null && !ConcatTreeList.isChild(serialized.root)) {
      throw new Error("Invalid ConcatTreeList root");
    }
    return new ConcatTreeList<T>(serialized.root ?? null, options);
  }

  private static fromChildren<T extends PiledriverObject>(children: Child[], options: { arity?: number }) {
    if (!children.length) return new ConcatTreeList<T>(null, options);
    const arity = Math.max(2, options.arity ?? defaultArity);
    let level = children;
    while (level.length > 1) {
      const next: Child[] = [];
      for (let i = 0; i < level.length; i += arity) {
        next.push(ConcatTreeList.child({ type: "node", children: level.slice(i, i + arity) }));
      }
      level = next;
    }
    return new ConcatTreeList<T>(level[0], options);
  }

  static async concatWithMergedBoundaries<T extends PiledriverObject>(lists: Iterable<ConcatTreeList<T>>, options: ConcatTreeListBoundaryOptions<T>): Promise<ConcatTreeList<T>> {
    const nonEmptyLists = [...lists].filter(list => list.root);
    const children: Child[] = [];
    for (let i = 0; i < nonEmptyLists.length; i++) {
      let root = nonEmptyLists[i].root;
      if (i > 0 && root) root = await ConcatTreeList.dropFirst(root);
      if (i < nonEmptyLists.length - 1 && root) root = await ConcatTreeList.dropLast(root);
      if (root) children.push(root);

      const next = nonEmptyLists.at(i + 1);
      if (next) {
        const leftLast = await ConcatTreeList.getEntryFrom<T>(nonEmptyLists[i].root!, nonEmptyLists[i].root!.size - 1);
        const rightFirst = await ConcatTreeList.getEntryFrom<T>(next.root!, 0);
        const boundaryValues = Array.from(options.mergeBoundary(leftLast[1], rightFirst[1]));
        const boundary = ConcatTreeList.fromEntries<T>(
          boundaryValues.map((value, index): Entry<T> => [
            index === 0 ? leftLast[0] : index === 1 ? rightFirst[0] : JSON.stringify([leftLast[0], rightFirst[0], index]),
            value,
          ]),
          options,
        );
        if (boundary.root) children.push(boundary.root);
      }
    }
    return ConcatTreeList.fromChildren(children, options);
  }

  private static child<T extends PiledriverObject>(node: Node<T>): Child {
    return {
      ref: asHeapObject(node as PiledriverObject),
      size: node.type === "leaf"
        ? node.entries.length
        : node.children.reduce((sum, child) => sum + child.size, 0),
    };
  }

  private static isChild(value: PiledriverObject | undefined): value is Child {
    const child = value as Partial<Child> | undefined;
    return !!value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof child?.size === "number"
      && !!child.ref
      && typeof child.ref === "object"
      && !Array.isArray(child.ref)
      && isPiledriverHeapObjectSymbol in child.ref;
  }

  private async node(child: Child) {
    return await child.ref.get() as Node<T>;
  }

  private async getFrom(child: Child, index: number): Promise<T> {
    return await ConcatTreeList.getFrom(child, index);
  }

  private static async getFrom<T extends PiledriverObject>(child: Child, index: number): Promise<T> {
    return (await ConcatTreeList.getEntryFrom<T>(child, index))[1];
  }

  private static async getEntryFrom<T extends PiledriverObject>(child: Child, index: number): Promise<Entry<T>> {
    const node = await child.ref.get() as Node<T>;
    if (node.type === "leaf") return node.entries[index];
    for (const child of node.children) {
      if (index < child.size) return await ConcatTreeList.getEntryFrom(child, index);
      index -= child.size;
    }
    throw new Error("ConcatTreeList index out of bounds");
  }

  private static async dropFirst<T extends PiledriverObject>(child: Child): Promise<Child | null> {
    const node = await child.ref.get() as Node<T>;
    if (node.type === "leaf") {
      return ConcatTreeList.childOrNull({ type: "leaf", entries: node.entries.slice(1) });
    }

    const first = await ConcatTreeList.dropFirst(node.children[0]);
    return ConcatTreeList.nodeChildOrNull(first ? [first, ...node.children.slice(1)] : node.children.slice(1));
  }

  private static async dropLast<T extends PiledriverObject>(child: Child): Promise<Child | null> {
    const node = await child.ref.get() as Node<T>;
    if (node.type === "leaf") {
      return ConcatTreeList.childOrNull({ type: "leaf", entries: node.entries.slice(0, -1) });
    }

    const last = await ConcatTreeList.dropLast(node.children[node.children.length - 1]);
    return ConcatTreeList.nodeChildOrNull(last ? [...node.children.slice(0, -1), last] : node.children.slice(0, -1));
  }

  private static childOrNull<T extends PiledriverObject>(node: Node<T>) {
    return node.type === "leaf" && !node.entries.length ? null : ConcatTreeList.child(node);
  }

  private static nodeChildOrNull(children: Child[]) {
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    return ConcatTreeList.child({ type: "node", children });
  }

  private static childSegments(children: Child[], segment: Segment) {
    const segments: Segment[] = [];
    const end = segment.start + segment.length;
    let childStart = 0;
    for (const child of children) {
      const childEnd = childStart + child.size;
      const start = Math.max(segment.start, childStart);
      const endInChild = Math.min(end, childEnd);
      if (start < endInChild) {
        segments.push({
          child,
          start: start - childStart,
          length: endInChild - start,
          baseIndex: segment.baseIndex + start - segment.start,
        });
      }
      childStart = childEnd;
      if (childStart >= end) break;
    }
    return segments;
  }

  private static async diffRanges<T extends PiledriverObject>(left: Segment | null, right: Segment | null, diff: ConcatTreeListDiff<T>) {
    if (!left && !right) return;
    if (!right) return await ConcatTreeList.collectRange(left!, diff.missing);
    if (!left) return await ConcatTreeList.collectRange(right, diff.added);

    const sharedLength = Math.min(left.length, right.length);
    if (sharedLength) {
      await ConcatTreeList.diffEqualLength(
        { ...left, length: sharedLength },
        { ...right, length: sharedLength },
        diff,
      );
    }
    if (left.length > sharedLength) {
      await ConcatTreeList.collectRange({ ...left, start: left.start + sharedLength, length: left.length - sharedLength, baseIndex: left.baseIndex + sharedLength }, diff.missing);
    }
    if (right.length > sharedLength) {
      await ConcatTreeList.collectRange({ ...right, start: right.start + sharedLength, length: right.length - sharedLength, baseIndex: right.baseIndex + sharedLength }, diff.added);
    }
  }

  private static async diffEqualLength<T extends PiledriverObject>(left: Segment, right: Segment, diff: ConcatTreeListDiff<T>) {
    if (!left.length) return;
    if (left.child.ref === right.child.ref && left.start === right.start && left.length === right.length) return;

    const leftNode = await left.child.ref.get() as Node<T>;
    const rightNode = await right.child.ref.get() as Node<T>;
    if (leftNode.type === "leaf" && rightNode.type === "leaf") {
      for (let i = 0; i < left.length; i++) {
        const leftEntry = leftNode.entries[left.start + i];
        const rightEntry = rightNode.entries[right.start + i];
        // Compare values too: ids are supposed to be stable, but callers may re-use an id with
        // a different value, and that must still be reported as a change.
        if (leftEntry[0] !== rightEntry[0] || !piledriverObjectEquals(leftEntry[1], rightEntry[1])) {
          diff.missing.push({ id: leftEntry[0], value: leftEntry[1] });
          diff.added.push({ id: rightEntry[0], value: rightEntry[1] });
        }
      }
      return;
    }

    const leftParts = leftNode.type === "leaf" ? [left] : ConcatTreeList.childSegments(leftNode.children, left);
    const rightParts = rightNode.type === "leaf" ? [right] : ConcatTreeList.childSegments(rightNode.children, right);
    await ConcatTreeList.diffParts(leftParts, rightParts, diff);
  }

  private static async diffParts<T extends PiledriverObject>(leftParts: Segment[], rightParts: Segment[], diff: ConcatTreeListDiff<T>) {
    let leftIndex = 0;
    let rightIndex = 0;
    let left = leftParts.at(leftIndex);
    let right = rightParts.at(rightIndex);
    while (left && right) {
      const length = Math.min(left.length, right.length);
      await ConcatTreeList.diffEqualLength({ ...left, length }, { ...right, length }, diff);
      left = left.length === length
        ? leftParts.at(++leftIndex)
        : { ...left, start: left.start + length, length: left.length - length, baseIndex: left.baseIndex + length };
      right = right.length === length
        ? rightParts.at(++rightIndex)
        : { ...right, start: right.start + length, length: right.length - length, baseIndex: right.baseIndex + length };
    }
  }

  private static async collectRange<T extends PiledriverObject>(segment: Segment, rows: { id: string, value: T }[]) {
    for (const [id, value] of await ConcatTreeList.collectEntries<T>(segment)) rows.push({ id, value });
  }

  private static async collectEntries<T extends PiledriverObject>(segment: Segment): Promise<Entry<T>[]> {
    const entries: Entry<T>[] = [];
    const node = await segment.child.ref.get() as Node<T>;
    if (node.type === "leaf") {
      for (let i = 0; i < segment.length; i++) {
        entries.push(node.entries[segment.start + i]);
      }
    } else {
      for (const childSegment of ConcatTreeList.childSegments(node.children, segment)) {
        entries.push(...await ConcatTreeList.collectEntries<T>(childSegment));
      }
    }
    return entries;
  }

  private async *walkEntries(child: Child | null, reverse: boolean): AsyncIterable<Entry<T>> {
    if (!child) return;
    const node = await this.node(child);
    if (node.type === "leaf") {
      if (reverse) {
        for (let i = node.entries.length - 1; i >= 0; i--) yield node.entries[i];
      } else {
        yield* node.entries;
      }
    } else {
      const children = reverse ? [...node.children].reverse() : node.children;
      for (const child of children) yield* this.walkEntries(child, reverse);
    }
  }
}
