import { describe, expect, it } from "vitest";
import { ArrayPaginatedList, PaginatedList } from "./paginated-lists";
import { stringCompare } from "./strings";

type NumberFilter = (item: number) => boolean;
type NumberOrderBy = (a: number, b: number) => number;

// Helper to extract just the items from a paginated result
const items = <T>(result: { items: { item: T }[] }) => result.items.map(i => i.item);

describe("ArrayPaginatedList", () => {
  describe("basic forward pagination (next)", () => {
    it("should return all items when limit is greater than array length", async () => {
      const list = new ArrayPaginatedList([1, 2, 3]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([1, 2, 3]);
      expect(result.isFirst).toBe(true);
      expect(result.isLast).toBe(true);
    });

    it("should return exact limit when more items exist", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([1, 2, 3]);
      expect(result.isFirst).toBe(true);
      expect(result.isLast).toBe(false);
    });

    it("should continue from cursor correctly", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const first = await list.next({
        after: list.getFirstCursor(),
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(first)).toEqual([1, 2]);
      expect(first.cursor).toBe("before-2");

      const second = await list.next({
        after: first.cursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(second)).toEqual([3, 4]);
      expect(second.isFirst).toBe(false);
      expect(second.isLast).toBe(false);
    });

    it("should handle empty array", async () => {
      const list = new ArrayPaginatedList<number>([]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([]);
      expect(result.isFirst).toBe(true);
      expect(result.isLast).toBe(true);
    });

    it("should handle limit of 0", async () => {
      const list = new ArrayPaginatedList([1, 2, 3]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 0,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([]);
    });
  });

  describe("backward pagination (prev)", () => {
    it("should return items before cursor", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.prev({
        before: list.getLastCursor(),
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([4, 5]);
      expect(result.isFirst).toBe(false);
      expect(result.isLast).toBe(true);
    });

    it("should paginate backwards correctly", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);

      const last = await list.prev({
        before: list.getLastCursor(),
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });
      expect(items(last)).toEqual([4, 5]);

      const middle = await list.prev({
        before: last.cursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });
      expect(items(middle)).toEqual([2, 3]);

      const first = await list.prev({
        before: middle.cursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });
      expect(items(first)).toEqual([1]);
      expect(first.isFirst).toBe(true);
    });
  });

  describe("cursor semantics (prevCursor and nextCursor)", () => {
    it("should have prevCursor before the item and nextCursor after", async () => {
      const list = new ArrayPaginatedList([10, 20, 30]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      // First item: prevCursor should be "before-0", nextCursor should be "before-1"
      expect(result.items[0].prevCursor).toBe("before-0");
      expect(result.items[0].nextCursor).toBe("before-1");

      // Second item
      expect(result.items[1].prevCursor).toBe("before-1");
      expect(result.items[1].nextCursor).toBe("before-2");

      // Third item
      expect(result.items[2].prevCursor).toBe("before-2");
      expect(result.items[2].nextCursor).toBe("before-3");
    });

    it("should allow using nextCursor to continue forward pagination", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);

      const first = await list.next({
        after: list.getFirstCursor(),
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      // Use the nextCursor of the last item to continue
      const continueFrom = first.items[first.items.length - 1].nextCursor;
      const second = await list.next({
        after: continueFrom,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(second)).toEqual([3, 4]);
    });

    it("should allow using prevCursor to go back", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);

      // Get items 3,4,5 first
      const middle = await list.next({
        after: "before-2",
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(middle)).toEqual([3, 4, 5]);
      expect(middle.items[0].prevCursor).toBe("before-2");

      // Use prevCursor of first item to go back
      const goBack = await list.prev({
        before: middle.items[0].prevCursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(goBack)).toEqual([1, 2]);
    });
  });

  describe("filtering", () => {
    it("should filter items correctly", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: (n) => n % 2 === 0, // only even numbers
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([2, 4, 6]);
    });

    it("should respect limit with filtering", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 2,
        filter: (n) => n % 2 === 0,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([2, 4]);
    });

    it("should handle filter that matches nothing", async () => {
      const list = new ArrayPaginatedList([1, 2, 3]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => false,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("should sort items in ascending order", async () => {
      const list = new ArrayPaginatedList([5, 2, 8, 1, 9]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([1, 2, 5, 8, 9]);
    });

    it("should sort items in descending order", async () => {
      const list = new ArrayPaginatedList([5, 2, 8, 1, 9]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => b - a,
        limitPrecision: "exact",
      });

      expect(items(result)).toEqual([9, 8, 5, 2, 1]);
    });

    it("should sort objects by property", async () => {
      const list = new ArrayPaginatedList([
        { name: "Charlie", age: 30 },
        { name: "Alice", age: 25 },
        { name: "Bob", age: 35 },
      ]);

      const byName = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => stringCompare(a.name, b.name),
        limitPrecision: "exact",
      });

      expect(items(byName).map(p => p.name)).toEqual(["Alice", "Bob", "Charlie"]);

      const byAge = await list.next({
        after: list.getFirstCursor(),
        limit: 10,
        filter: () => true,
        orderBy: (a, b) => a.age - b.age,
        limitPrecision: "exact",
      });

      expect(items(byAge).map(p => p.name)).toEqual(["Alice", "Charlie", "Bob"]);
    });
  });

  describe("limitPrecision", () => {
    it("exact should return exactly the limit", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      expect(result.items.length).toBe(3);
    });

    // Note: ArrayPaginatedList always returns exact results since it has all data in memory
    // These tests verify the contract is respected
    it("at-least should return at least the limit (or all if less available)", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "at-least",
      });

      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("at-most should return at most the limit", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "at-most",
      });

      expect(result.items.length).toBeLessThanOrEqual(3);
    });

    it("approximate should allow flexibility in either direction", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
      const result = await list.next({
        after: list.getFirstCursor(),
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "approximate",
      });

      // With 'approximate', the implementation can return more or fewer items
      // than requested. We just verify it returns some items and makes progress.
      expect(result.items.length).toBeGreaterThan(0);
      // Should still return valid items
      expect(items(result).every(n => typeof n === "number")).toBe(true);
    });

    it("approximate should still make progress when limit > 0", async () => {
      const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const allItems: number[] = [];

      let cursor = list.getFirstCursor();
      let iterations = 0;
      const maxIterations = 20; // Safety limit to prevent infinite loops

      while (iterations < maxIterations) {
        const result = await list.next({
          after: cursor,
          limit: 2,
          filter: () => true,
          orderBy: (a, b) => a - b,
          limitPrecision: "approximate",
        });

        if (result.items.length === 0) break;

        allItems.push(...items(result));
        // Cursor must change to ensure progress
        expect(result.cursor).not.toBe(cursor);
        cursor = result.cursor;
        iterations++;

        if (result.isLast) break;
      }

      // Should eventually get all items
      expect(allItems.length).toBeGreaterThan(0);
    });
  });

  describe("getFirstCursor and getLastCursor", () => {
    it("should return correct cursor format", () => {
      const list = new ArrayPaginatedList([1, 2, 3]);
      expect(list.getFirstCursor()).toBe("before-0");
      expect(list.getLastCursor()).toBe("before-3");
    });

    it("should work for empty array", () => {
      const list = new ArrayPaginatedList([]);
      expect(list.getFirstCursor()).toBe("before-0");
      expect(list.getLastCursor()).toBe("before-0");
    });
  });

  describe("compare", () => {
    it("should compare items using the orderBy function", () => {
      const list = new ArrayPaginatedList([1, 2, 3]);
      const orderBy = (a: number, b: number) => a - b;

      expect(list.compare(orderBy, 1, 2)).toBeLessThan(0);
      expect(list.compare(orderBy, 2, 1)).toBeGreaterThan(0);
      expect(list.compare(orderBy, 1, 1)).toBe(0);
    });
  });
});

describe("PaginatedList.empty", () => {
  it("should return empty results", async () => {
    const list = PaginatedList.empty();
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: {},
      orderBy: {},
      limitPrecision: "exact",
    });

    expect(result.items).toEqual([]);
    expect(result.isFirst).toBe(true);
    expect(result.isLast).toBe(true);
  });

  it("should have first cursor", () => {
    const list = PaginatedList.empty();
    expect(list.getFirstCursor()).toBe("first");
    expect(list.getLastCursor()).toBe("last");
  });
});

describe("PaginatedList.map", () => {
  it("should transform items", async () => {
    const list = new ArrayPaginatedList([1, 2, 3]);
    const doubled = list.map<number, NumberFilter, NumberOrderBy>({
      itemMapper: (n) => n * 2,
      oldItemFromNewItem: (n) => n / 2,
      oldFilterFromNewFilter: (f) => f,
      oldOrderByFromNewOrderBy: (o) => o,
    });

    const result = await doubled.next({
      after: doubled.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([2, 4, 6]);
  });

  it("should preserve cursor semantics", async () => {
    const list = new ArrayPaginatedList([1, 2, 3]);
    const doubled = list.map<number, NumberFilter, NumberOrderBy>({
      itemMapper: (n) => n * 2,
      oldItemFromNewItem: (n) => n / 2,
      oldFilterFromNewFilter: (f) => f,
      oldOrderByFromNewOrderBy: (o) => o,
    });

    const first = await doubled.next({
      after: doubled.getFirstCursor(),
      limit: 1,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(first)).toEqual([2]);

    const second = await doubled.next({
      after: first.cursor,
      limit: 1,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(second)).toEqual([4]);
  });
});

describe("PaginatedList.filter", () => {
  it("should filter items", async () => {
    const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6]);
    const evens = list.filter({
      filter: (n) => n % 2 === 0,
      oldFilterFromNewFilter: () => () => true,
      estimateItemsToFetch: ({ limit }) => limit * 2,
    });

    const result = await evens.next({
      after: evens.getFirstCursor(),
      limit: 10,
      filter: undefined,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([2, 4, 6]);
  });
});

describe("PaginatedList.addFilter", () => {
  it("should add additional filter constraint", async () => {
    const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // First filter: only even
    const evens = list.filter({
      filter: (n) => n % 2 === 0,
      oldFilterFromNewFilter: () => () => true,
      estimateItemsToFetch: ({ limit }) => limit * 2,
    });

    // Add filter: only > 5
    const evenAndGreaterThan5 = evens.addFilter({
      filter: (n) => n > 5,
      estimateItemsToFetch: ({ limit }) => limit * 2,
    });

    const result = await evenAndGreaterThan5.next({
      after: evenAndGreaterThan5.getFirstCursor(),
      limit: 10,
      filter: undefined,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([6, 8, 10]);
  });
});

describe("PaginatedList.flatMap", () => {
  it("should expand items", async () => {
    const list = new ArrayPaginatedList([1, 2, 3]);
    const expanded = list.flatMap<number, `before-${number}`, NumberFilter, NumberOrderBy>({
      itemMapper: (entry) => [
        { item: entry.item, prevCursor: entry.prevCursor, nextCursor: entry.nextCursor },
        { item: entry.item + 0.5, prevCursor: entry.prevCursor, nextCursor: entry.nextCursor },
      ],
      compare: (_, a, b) => a - b,
      newCursorFromOldCursor: (c) => c,
      oldCursorFromNewCursor: (c) => c,
      oldFilterFromNewFilter: (f) => f,
      oldOrderByFromNewOrderBy: (o) => o,
      estimateItemsToFetch: ({ limit }) => limit,
    });

    const result = await expanded.next({
      after: expanded.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it("should filter out items (return empty array)", async () => {
    const list = new ArrayPaginatedList([1, 2, 3, 4, 5]);
    const evensOnly = list.flatMap<number, `before-${number}`, NumberFilter, NumberOrderBy>({
      itemMapper: (entry) => entry.item % 2 === 0
        ? [{ item: entry.item, prevCursor: entry.prevCursor, nextCursor: entry.nextCursor }]
        : [],
      compare: (_, a, b) => a - b,
      newCursorFromOldCursor: (c) => c,
      oldCursorFromNewCursor: (c) => c,
      oldFilterFromNewFilter: (f) => f,
      oldOrderByFromNewOrderBy: (o) => o,
      estimateItemsToFetch: ({ limit }) => limit * 2,
    });

    const result = await evensOnly.next({
      after: evensOnly.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([2, 4]);
  });
});

describe("PaginatedList.merge", () => {
  it("should merge two lists", async () => {
    const list1 = new ArrayPaginatedList([1, 3, 5]);
    const list2 = new ArrayPaginatedList([2, 4, 6]);

    const merged = PaginatedList.merge(list1, list2);

    const result = await merged.next({
      after: merged.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("should merge three lists", async () => {
    const list1 = new ArrayPaginatedList([1, 4, 7]);
    const list2 = new ArrayPaginatedList([2, 5, 8]);
    const list3 = new ArrayPaginatedList([3, 6, 9]);

    const merged = PaginatedList.merge(list1, list2, list3);

    const result = await merged.next({
      after: merged.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("should handle empty lists in merge", async () => {
    const list1 = new ArrayPaginatedList([1, 2, 3]);
    const list2 = new ArrayPaginatedList<number>([]);

    const merged = PaginatedList.merge(list1, list2);

    const result = await merged.next({
      after: merged.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([1, 2, 3]);
  });

  it("should paginate through merged list", async () => {
    const list1 = new ArrayPaginatedList([1, 3, 5, 7, 9]);
    const list2 = new ArrayPaginatedList([2, 4, 6, 8, 10]);

    const merged = PaginatedList.merge(list1, list2);

    const first = await merged.next({
      after: merged.getFirstCursor(),
      limit: 4,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(first)).toEqual([1, 2, 3, 4]);

    const second = await merged.next({
      after: first.cursor,
      limit: 4,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(second)).toEqual([5, 6, 7, 8]);
  });

  it("should have JSON-encoded cursor", () => {
    const list1 = new ArrayPaginatedList([1, 2]);
    const list2 = new ArrayPaginatedList([3, 4]);

    const merged = PaginatedList.merge(list1, list2);
    const cursor = merged.getFirstCursor();

    expect(() => JSON.parse(cursor)).not.toThrow();
    expect(JSON.parse(cursor)).toEqual(["before-0", "before-0"]);
  });

  it("should paginate backward through merged list correctly", async () => {
    const list1 = new ArrayPaginatedList([1, 3, 5]);
    const list2 = new ArrayPaginatedList([2, 4, 6]);

    const merged = PaginatedList.merge(list1, list2);

    // Get last 3 items going backward
    const last = await merged.prev({
      before: merged.getLastCursor(),
      limit: 3,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(last)).toEqual([4, 5, 6]);
    expect(last.isLast).toBe(true);
    expect(last.isFirst).toBe(false);

    // Continue backward to get previous 3 items
    const middle = await merged.prev({
      before: last.cursor,
      limit: 3,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(middle)).toEqual([1, 2, 3]);
    expect(middle.isFirst).toBe(true);
  });

  it("should paginate backward through entire merged list", async () => {
    const list1 = new ArrayPaginatedList([1, 3, 5, 7, 9]);
    const list2 = new ArrayPaginatedList([2, 4, 6, 8, 10]);

    const merged = PaginatedList.merge(list1, list2);
    const allItems: number[] = [];

    let cursor = merged.getLastCursor();
    let isFirst = false;

    while (!isFirst) {
      const result = await merged.prev({
        before: cursor,
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      allItems.unshift(...items(result));
      cursor = result.cursor;
      isFirst = result.isFirst;
    }

    expect(allItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("should have consistent forward and backward pagination results", async () => {
    const list1 = new ArrayPaginatedList([1, 4, 7]);
    const list2 = new ArrayPaginatedList([2, 5, 8]);
    const list3 = new ArrayPaginatedList([3, 6, 9]);

    const merged = PaginatedList.merge(list1, list2, list3);

    // Collect all items going forward
    const forwardItems: number[] = [];
    let forwardCursor = merged.getFirstCursor();
    let isLast = false;

    while (!isLast) {
      const result = await merged.next({
        after: forwardCursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      forwardItems.push(...items(result));
      forwardCursor = result.cursor;
      isLast = result.isLast;
    }

    // Collect all items going backward
    const backwardItems: number[] = [];
    let backwardCursor = merged.getLastCursor();
    let isFirst = false;

    while (!isFirst) {
      const result = await merged.prev({
        before: backwardCursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      backwardItems.unshift(...items(result));
      backwardCursor = result.cursor;
      isFirst = result.isFirst;
    }

    // Both directions should yield the same final result
    expect(forwardItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(backwardItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("edge cases", () => {
  it("should handle single item", async () => {
    const list = new ArrayPaginatedList([42]);
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([42]);
    expect(result.isFirst).toBe(true);
    expect(result.isLast).toBe(true);
  });

  it("should handle duplicate values", async () => {
    const list = new ArrayPaginatedList([1, 1, 2, 2, 3, 3]);
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("should handle negative numbers", async () => {
    const list = new ArrayPaginatedList([-3, -1, 0, 1, 3]);
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([-3, -1, 0, 1, 3]);
  });

  it("should handle string items", async () => {
    const list = new ArrayPaginatedList(["banana", "apple", "cherry"]);
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => stringCompare(a, b),
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual(["apple", "banana", "cherry"]);
  });

  it("should handle object items", async () => {
    const list = new ArrayPaginatedList([
      { id: 1, value: "a" },
      { id: 2, value: "b" },
    ]);
    const result = await list.next({
      after: list.getFirstCursor(),
      limit: 10,
      filter: () => true,
      orderBy: (a, b) => a.id - b.id,
      limitPrecision: "exact",
    });

    expect(items(result)).toEqual([
      { id: 1, value: "a" },
      { id: 2, value: "b" },
    ]);
  });
});

describe("complete pagination walkthrough", () => {
  it("should paginate forward through entire list", async () => {
    const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const allItems: number[] = [];

    let cursor = list.getFirstCursor();
    let isLast = false;

    while (!isLast) {
      const result = await list.next({
        after: cursor,
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      allItems.push(...items(result));
      cursor = result.cursor;
      isLast = result.isLast;
    }

    expect(allItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("should paginate backward through entire list", async () => {
    const list = new ArrayPaginatedList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const allItems: number[] = [];

    let cursor = list.getLastCursor();
    let isFirst = false;

    while (!isFirst) {
      const result = await list.prev({
        before: cursor,
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      allItems.unshift(...items(result));
      cursor = result.cursor;
      isFirst = result.isFirst;
    }

    expect(allItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("unsorted array pagination", () => {
  it("should correctly paginate through an unsorted array with sorting", async () => {
    const list = new ArrayPaginatedList([3, 1, 2]);

    const first = await list.next({
      after: list.getFirstCursor(),
      limit: 2,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(first)).toEqual([1, 2]);

    const second = await list.next({
      after: first.cursor,
      limit: 2,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(second)).toEqual([3]);
  });

  it("should maintain sorted order across pagination boundaries", async () => {
    const list = new ArrayPaginatedList([5, 4, 3, 2, 1]);
    const allItems: number[] = [];

    let cursor = list.getFirstCursor();
    let isLast = false;

    while (!isLast) {
      const result = await list.next({
        after: cursor,
        limit: 2,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      allItems.push(...items(result));
      cursor = result.cursor;
      isLast = result.isLast;
    }

    expect(allItems).toEqual([1, 2, 3, 4, 5]);
  });

  it("should handle random order array correctly", async () => {
    const list = new ArrayPaginatedList([7, 2, 9, 1, 5, 8, 3, 6, 4]);

    const allItems: number[] = [];
    let cursor = list.getFirstCursor();
    let isLast = false;

    while (!isLast) {
      const result = await list.next({
        after: cursor,
        limit: 3,
        filter: () => true,
        orderBy: (a, b) => a - b,
        limitPrecision: "exact",
      });

      allItems.push(...items(result));
      cursor = result.cursor;
      isLast = result.isLast;
    }

    expect(allItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("should have consistent cursor semantics with sorted data", async () => {
    const list = new ArrayPaginatedList([3, 1, 2]);

    const first = await list.next({
      after: list.getFirstCursor(),
      limit: 1,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(first)).toEqual([1]);

    const second = await list.next({
      after: first.cursor,
      limit: 1,
      filter: () => true,
      orderBy: (a, b) => a - b,
      limitPrecision: "exact",
    });

    expect(items(second)).toEqual([2]);
  });
});

