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
function isConcatChild(value: unknown): value is Child {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "ref" in value
    && typeof value.ref === "object"
    && value.ref !== null
    && isPiledriverHeapObjectSymbol in value.ref
    && "size" in value
    && typeof value.size === "number";
}
function isConcatNode<T extends PiledriverObject>(value: unknown): value is Node<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) return false;
  if (value.type === "leaf") {
    return "entries" in value && Array.isArray(value.entries)
      && value.entries.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
  }
  return value.type === "node" && "children" in value && Array.isArray(value.children) && value.children.every(isConcatChild);
}
function isConcatRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export type ConcatTreeIntegrityResult = {
  issues: { code: string, message: string }[],
  stepsTaken: number,
  nextPosition: string | null,
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

  async verifyDataIntegrity(options: { stepBudget: number, position: string | null }): Promise<ConcatTreeIntegrityResult> {
    if (!Number.isSafeInteger(options.stepBudget) || options.stepBudget <= 0) throw new Error("Invalid tree verification step budget");
    const issues: { code: string, message: string }[] = [];
    const arity = Math.max(2, this.options.arity ?? defaultArity);
    type Summary = { height: number, size: number };
    type Frame = { child: Child, node: Node<T>, path: number[], nextChild: number, children: Summary[] };
    const root = this.root;
    if (root === null) return { issues, stepsTaken: 0, nextPosition: null };
    const rootNode = await root.ref.get();
    if (!isConcatNode<T>(rootNode)) return { issues: [{ code: "invalid_node", message: "A concat tree child does not contain a valid node" }], stepsTaken: 1, nextPosition: null };
    const parsedPosition: unknown = options.position === null ? null : JSON.parse(options.position);
    const savedFrames: unknown[] = parsedPosition === null
      ? []
      : isConcatRecord(parsedPosition) && Array.isArray(parsedPosition.frames)
        ? parsedPosition.frames
        : (() => { throw new Error("Invalid concat tree verification position"); })();
    const frameFrom = async (child: Child, node: Node<T>, path: number[], saved: unknown): Promise<Frame> => {
      const savedRecord = isConcatRecord(saved) ? saved : {};
      const nextChild = typeof savedRecord.nextChild === "number" && Number.isSafeInteger(savedRecord.nextChild)
        ? savedRecord.nextChild
        : 0;
      const children = Array.isArray(savedRecord.children) && savedRecord.children.every(value => isConcatRecord(value)
        && typeof value.height === "number"
        && typeof value.size === "number")
        ? savedRecord.children.map(value => ({ height: value.height, size: value.size }))
        : [];
      return { child, node, path, nextChild, children };
    };
    const stack: Frame[] = [await frameFrom(root, rootNode, [], savedFrames[0])];
    for (let index = 1; index < savedFrames.length; index++) {
      const saved = savedFrames[index];
      if (!isConcatRecord(saved) || !Array.isArray(saved.path) || !saved.path.every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("Invalid concat tree verification position");
      }
      const parent = stack[stack.length - 1];
      const childIndex = saved.path[saved.path.length - 1];
      if (childIndex === undefined || parent.node.type !== "node" || childIndex >= parent.node.children.length) {
        throw new Error("Invalid concat tree verification position");
      }
      parent.nextChild = Math.max(parent.nextChild, childIndex + 1);
      const child = parent.node.children[childIndex];
      const value = await child.ref.get();
      if (!isConcatNode<T>(value)) throw new Error("Invalid concat tree verification position");
      stack.push(await frameFrom(child, value, saved.path, saved));
    }
    let stepsTaken = 0;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.node.type === "node" && frame.nextChild < frame.node.children.length) {
        const childIndex = frame.nextChild++;
        const child = frame.node.children[childIndex];
        const value = await child.ref.get();
        if (!isConcatNode<T>(value)) {
          issues.push({ code: "invalid_node", message: "A concat tree child does not contain a valid node" });
          continue;
        }
        stack.push({ child, node: value, path: [...frame.path, childIndex], nextChild: 0, children: [] });
        continue;
      }
      if (stepsTaken >= options.stepBudget) {
        return { issues, stepsTaken, nextPosition: JSON.stringify({ frames: stack.map(item => ({ path: item.path, nextChild: item.nextChild, children: item.children })) }) };
      }
      stepsTaken++;
      const node = frame.node;
      if (node.type === "leaf") {
        if (node.entries.length > arity) issues.push({ code: "node_arity", message: "A list leaf exceeds the maximum entry count" });
        if (frame.path.length > 0 && node.entries.length === 0) issues.push({ code: "node_occupancy", message: "A non-root list leaf is empty" });
        if (frame.child.size !== node.entries.length) issues.push({ code: "size", message: "A list leaf size does not match its contents" });
        const summary: Summary = { height: 1, size: node.entries.length };
        stack.pop();
        if (stack.length > 0) stack[stack.length - 1].children.push(summary);
        continue;
      }
      if (node.children.length > arity) issues.push({ code: "node_arity", message: "A list node exceeds the maximum child count" });
      if (frame.path.length > 0 && node.children.length < 2) issues.push({ code: "node_occupancy", message: "A non-root list node has too few children" });
      const heights = frame.children.map(result => result.height);
      if (heights.some(height => height !== heights[0])) issues.push({ code: "child_height", message: "List children do not have equal heights" });
      const size = frame.children.reduce((sum, result) => sum + result.size, 0);
      if (frame.child.size !== size) issues.push({ code: "size", message: "A list node size does not match its children" });
      const summary: Summary = { height: (heights[0] ?? 0) + 1, size };
      stack.pop();
      if (stack.length > 0) stack[stack.length - 1].children.push(summary);
    }
    return { issues, stepsTaken, nextPosition: null };
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
