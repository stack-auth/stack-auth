import { StackAssertionError } from "./errors";

type QueryOptions<Type extends 'next' | 'prev', Cursor, Filter, OrderBy> =
  & {
    filter: Filter,
    orderBy: OrderBy,
    limit: number,
    /**
     * Whether the limit should be treated as an exact value, or an approximate value.
     *
     * If set to 'exact', less items will only be returned if the list item is the first or last item.
     *
     * If set to 'at-least' or 'approximate', the implementation may decide to return more items than the limit requested if doing so comes at no (or negligible) extra cost.
     *
     * If set to 'at-most' or 'approximate', the implementation may decide to return less items than the limit requested if requesting more items would come at a non-negligible extra cost. In this case, if limit > 0, the implementation must still make progress towards the end of the list and the returned cursor must be different from the one passed in.
     *
     * Defaults to 'exact'.
     */
    limitPrecision: 'exact' | 'at-least' | 'at-most' | 'approximate',
  }
  & ([Type] extends [never] ? unknown
    : [Type] extends ['next'] ? { after: Cursor }
    : [Type] extends ['prev'] ? { before: Cursor }
    : { cursor: Cursor });

type ImplQueryOptions<Type extends 'next' | 'prev', Cursor, Filter, OrderBy> = QueryOptions<Type, Cursor, Filter, OrderBy> & { limitPrecision: 'approximate' }

type QueryResult<Item, Cursor> = { items: { item: Item, prevCursor: Cursor, nextCursor: Cursor }[], isFirst: boolean, isLast: boolean, cursor: Cursor }

type ImplQueryResult<Item, Cursor> = { items: { item: Item, prevCursor: Cursor, nextCursor: Cursor }[], isFirst: boolean, isLast: boolean, cursor: Cursor }

/**
 * Abstract base class for cursor-based pagination over any ordered data source.
 *
 * Subclasses implement `_nextOrPrev` to fetch items in one direction. This class handles
 * limit enforcement, sorting validation, and provides `map`, `filter`, `flatMap`, and `merge` utilities.
 *
 * @template Item - The type of items in the list
 * @template Cursor - A string-based cursor type for position tracking. Cursors are always between two items in the list. Note that cursors may not be stable if the filter or orderBy changes.
 * @template Filter - Query filter type
 * @template OrderBy - Sort order specification type
 *
 * @example
 * ```ts
 * // Basic usage: paginate through users
 * const users = new MyUserList();
 * const first10 = await users.next({ after: users.getFirstCursor(), limit: 10, filter: {}, orderBy: 'name', limitPrecision: 'exact' });
 * // first10 = { items: [...], isFirst: true, isLast: false, cursor: "cursor-after-item-10" }
 *
 * const next10 = await users.next({ after: first10.cursor, limit: 10, filter: {}, orderBy: 'name', limitPrecision: 'exact' });
 * // Continues from where we left off
 * ```
 */
export abstract class PaginatedList<
  Item,
  Cursor extends string,
  Filter extends unknown,
  OrderBy extends unknown,
> {
  // Abstract methods

  protected abstract _getFirstCursor(): Cursor;
  protected abstract _getLastCursor(): Cursor;
  protected abstract _compare(orderBy: OrderBy, a: Item, b: Item): number;
  protected abstract _nextOrPrev(type: 'next' | 'prev', options: ImplQueryOptions<'next' | 'prev', Cursor, Filter, OrderBy>): Promise<ImplQueryResult<Item, Cursor>>;

  // Implementations

  /** Returns the cursor pointing to the start of the list (before any items). */
  public getFirstCursor(): Cursor { return this._getFirstCursor(); }

  /** Returns the cursor pointing to the end of the list (after all items). */
  public getLastCursor(): Cursor { return this._getLastCursor(); }

  /** Compares two items according to the given orderBy. Returns negative if a < b, 0 if equal, positive if a > b. */
  public compare(orderBy: OrderBy, a: Item, b: Item): number { return this._compare(orderBy, a, b); }

  /**
   * Fetches items moving forward ('next') or backward ('prev') from the given cursor.
   *
   * Respects `limitPrecision`: 'exact' guarantees the exact limit, 'at-least'/'at-most'/'approximate'
   * allow flexibility for performance. Returns items, boundary flags, and a new cursor.
   *
   * @example
   * ```ts
   * // Get 5 items after the start
   * const result = await list.nextOrPrev('next', { cursor: list.getFirstCursor(), limit: 5, filter: {}, orderBy: 'asc', limitPrecision: 'exact' });
   * // result.items.length === 5 (or less if list has fewer items)
   * // result.isFirst === true (started at first cursor)
   * // result.isLast === true if we got all remaining items
   *
   * // Continue from where we left off
   * const more = await list.nextOrPrev('next', { cursor: result.cursor, limit: 5, ... });
   * ```
   */
  async nextOrPrev(type: 'next' | 'prev', options: QueryOptions<'next' | 'prev', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    let result: { item: Item, prevCursor: Cursor, nextCursor: Cursor }[] = [];
    let includesFirst = false;
    let includesLast = false;
    let cursor = options.cursor;
    let limitRemaining = options.limit;
    while (limitRemaining > 0 && (type !== "next" || !includesLast) && (type !== "prev" || !includesFirst)) {
      const iterationRes = await this._nextOrPrev(type, {
        cursor,
        limit: options.limit,
        limitPrecision: "approximate",
        filter: options.filter,
        orderBy: options.orderBy,
      });
      result[type === "next" ? "push" : "unshift"](...iterationRes.items);
      limitRemaining -= iterationRes.items.length;
      includesFirst ||= iterationRes.isFirst;
      includesLast ||= iterationRes.isLast;
      cursor = iterationRes.cursor;
      if (["approximate", "at-most"].includes(options.limitPrecision)) break;
    }

    // Assert that the result is sorted
    for (let i = 1; i < result.length; i++) {
      if (this._compare(options.orderBy, result[i].item, result[i - 1].item) < 0) {
        throw new StackAssertionError("Paginated list result is not sorted; something is wrong with the implementation", {
          i,
          options,
          result,
        });
      }
    }

    if (["exact", "at-most"].includes(options.limitPrecision) && result.length > options.limit) {
      if (type === "next") {
        result = result.slice(0, options.limit);
        includesLast = false;
        if (options.limit > 0) cursor = result[result.length - 1].nextCursor;
      } else {
        result = result.slice(result.length - options.limit);
        includesFirst = false;
        if (options.limit > 0) cursor = result[0].prevCursor;
      }
    }
    return { items: result, isFirst: includesFirst, isLast: includesLast, cursor };
  }
  /** Fetches items after the given cursor (forward pagination). */
  public async next({ after, ...rest }: QueryOptions<'next', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    return await this.nextOrPrev("next", {
      ...rest,
      cursor: after,
    });
  }

  /** Fetches items before the given cursor (backward pagination). */
  public async prev({ before, ...rest }: QueryOptions<'prev', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    return await this.nextOrPrev("prev", {
      ...rest,
      cursor: before,
    });
  }

  // Utility methods below

  /**
   * Transforms this list by mapping each item to zero or more new items.
   *
   * Note that the sort order must be preserved after the operation; the flat-mapped list will not be sorted automatically.
   *
   * @param itemMapper - Maps each item (with its cursor) to an array of new items
   * @param compare - Comparison function for the new item type
   * @param newCursorFromOldCursor/oldCursorFromNewCursor - Cursor conversion functions
   * @param estimateItemsToFetch - Estimates how many source items to fetch for a given limit
   *
   * @example
   * ```ts
   * // Expand orders into line items (1 order -> N line items)
   * const lineItems = ordersList.flatMap({
   *   itemMapper: ({ item: order }) => order.lineItems.map((li, i) => ({ item: li, prevCursor: `${order.id}-${i}`, nextCursor: `${order.id}-${i + 1}` })),
   *   compare: (_, a, b) => a.createdAt - b.createdAt,
   *   estimateItemsToFetch: ({ limit }) => Math.ceil(limit / 3), // avg 3 items per order
   *   // ... cursor converters
   * });
   * ```
   */
  flatMap<Item2, Cursor2 extends string, Filter2 extends unknown, OrderBy2 extends unknown>(options: {
    itemMapper: (itemEntry: { item: Item, prevCursor: Cursor, nextCursor: Cursor }, filter: Filter2, orderBy: OrderBy2) => { item: Item2, prevCursor: Cursor2, nextCursor: Cursor2 }[],
    compare: (orderBy: OrderBy2, a: Item2, b: Item2) => number,
    newCursorFromOldCursor: (cursor: Cursor) => Cursor2,
    oldCursorFromNewCursor: (cursor: Cursor2) => Cursor,
    oldFilterFromNewFilter: (filter: Filter2) => Filter,
    oldOrderByFromNewOrderBy: (orderBy: OrderBy2) => OrderBy,
    estimateItemsToFetch: (options: { filter: Filter2, orderBy: OrderBy2, limit: number }) => number,
  }): PaginatedList<Item2, Cursor2, Filter2, OrderBy2> {
    const that = this;
    class FlatMapPaginatedList extends PaginatedList<Item2, Cursor2, Filter2, OrderBy2> {
      override _getFirstCursor(): Cursor2 { return options.newCursorFromOldCursor(that.getFirstCursor()); }
      override _getLastCursor(): Cursor2 { return options.newCursorFromOldCursor(that.getLastCursor()); }

      override _compare(orderBy: OrderBy2, a: Item2, b: Item2): number {
        return options.compare(orderBy, a, b);
      }

      override async _nextOrPrev(type: 'next' | 'prev', { limit, filter, orderBy, cursor }: ImplQueryOptions<'next' | 'prev', Cursor2, Filter2, OrderBy2>) {
        const estimatedItems = options.estimateItemsToFetch({ limit, filter, orderBy });
        const original = await that.nextOrPrev(type, {
          limit: estimatedItems,
          limitPrecision: "approximate",
          cursor: options.oldCursorFromNewCursor(cursor),
          filter: options.oldFilterFromNewFilter(filter),
          orderBy: options.oldOrderByFromNewOrderBy(orderBy),
        });
        const mapped = original.items.flatMap(itemEntry => options.itemMapper(
          itemEntry,
          filter,
          orderBy,
        ));
        return {
          items: mapped,
          isFirst: original.isFirst,
          isLast: original.isLast,
          cursor: options.newCursorFromOldCursor(original.cursor),
        };
      }
    }
    return new FlatMapPaginatedList();
  }

  /**
   * Transforms each item in the list. Requires a reverse mapper for comparison delegation.
   *
   * @param itemMapper - Transforms each item
   * @param oldItemFromNewItem - Reverse-maps new items back to old items (for comparison)
   *
   * @example
   * ```ts
   * // Convert User objects to UserDTO
   * const userDtos = usersList.map({
   *   itemMapper: (user) => ({ id: user.id, displayName: user.name }),
   *   oldItemFromNewItem: (dto) => fullUsers.get(dto.id)!, // for comparison
   *   oldFilterFromNewFilter: (f) => f,
   *   oldOrderByFromNewOrderBy: (o) => o,
   * });
   * ```
   */
  map<Item2, Filter2 extends unknown, OrderBy2 extends unknown>(options: {
    itemMapper: (item: Item) => Item2,
    oldItemFromNewItem: (item: Item2) => Item,
    oldFilterFromNewFilter: (filter: Filter2) => Filter,
    oldOrderByFromNewOrderBy: (orderBy: OrderBy2) => OrderBy,
  }): PaginatedList<Item2, Cursor, Filter2, OrderBy2> {
    return this.flatMap({
      itemMapper: (itemEntry, filter, orderBy) => {
        return [{ item: options.itemMapper(itemEntry.item), prevCursor: itemEntry.prevCursor, nextCursor: itemEntry.nextCursor }];
      },
      compare: (orderBy, a, b) => this.compare(options.oldOrderByFromNewOrderBy(orderBy), options.oldItemFromNewItem(a), options.oldItemFromNewItem(b)),
      newCursorFromOldCursor: (cursor) => cursor,
      oldCursorFromNewCursor: (cursor) => cursor,
      oldFilterFromNewFilter: (filter) => options.oldFilterFromNewFilter(filter),
      oldOrderByFromNewOrderBy: (orderBy) => options.oldOrderByFromNewOrderBy(orderBy),
      estimateItemsToFetch: (options) => options.limit,
    });
  }

  /**
   * Filters items in the list. Requires an estimate function since filtering may reduce output.
   *
   * @param filter - Predicate to include/exclude items
   * @param estimateItemsToFetch - Estimates how many source items to fetch (accounts for filter selectivity)
   *
   * @example
   * ```ts
   * // Filter to only active users
   * const activeUsers = usersList.filter({
   *   filter: (user, filterOpts) => user.isActive && user.role === filterOpts.role,
   *   oldFilterFromNewFilter: (f) => ({}), // original list has no filter
   *   estimateItemsToFetch: ({ limit }) => limit * 2, // expect ~50% active
   * });
   * ```
   */
  filter<Filter2 extends unknown>(options: {
    filter: (item: Item, filter: Filter2) => boolean,
    oldFilterFromNewFilter: (filter: Filter2) => Filter,
    estimateItemsToFetch: (options: { filter: Filter2, orderBy: OrderBy, limit: number }) => number,
  }): PaginatedList<Item, Cursor, Filter2, OrderBy> {
    return this.flatMap({
      itemMapper: (itemEntry, filter, orderBy) => (options.filter(itemEntry.item, filter) ? [itemEntry] : []),
      compare: (orderBy, a, b) => this.compare(orderBy, a, b),
      newCursorFromOldCursor: (cursor) => cursor,
      oldCursorFromNewCursor: (cursor) => cursor,
      oldFilterFromNewFilter: (filter) => options.oldFilterFromNewFilter(filter),
      oldOrderByFromNewOrderBy: (orderBy) => orderBy,
      estimateItemsToFetch: (o) => options.estimateItemsToFetch(o),
    });
  }

  /**
   * Adds an additional filter constraint while preserving the original filter type.
   * Shorthand for `filter()` that intersects Filter with AddedFilter.
   *
   * @example
   * ```ts
   * // Add a "verified" filter on top of existing filters
   * const verifiedUsers = usersList.addFilter({
   *   filter: (user, f) => user.emailVerified,
   *   estimateItemsToFetch: ({ limit }) => limit * 2, // ~50% are verified
   * });
   * // verifiedUsers filter type is Filter
   * ```
   */
  addFilter<AddedFilter extends unknown>(options: {
    filter: (item: Item, filter: Filter & AddedFilter) => boolean,
    estimateItemsToFetch: (options: { filter: Filter & AddedFilter, orderBy: OrderBy, limit: number }) => number,
  }): PaginatedList<Item, Cursor, Filter & AddedFilter, OrderBy> {
    return this.filter({
      filter: (item, filter) => options.filter(item, filter),
      oldFilterFromNewFilter: (filter) => filter,
      estimateItemsToFetch: (o) => options.estimateItemsToFetch(o),
    });
  }

  /**
   * Merges multiple paginated lists into one, interleaving items by sort order.
   * All lists must use the same compare function.
   *
   * The merged cursor is a JSON-encoded array of individual list cursors.
   *
   * @example
   * ```ts
   * // Merge users from multiple sources into a unified feed
   * const allUsers = PaginatedList.merge(internalUsers, externalUsers, partnerUsers);
   * const page = await allUsers.next({ after: allUsers.getFirstCursor(), limit: 20, ... });
   * // page.items contains interleaved items from all sources, sorted by orderBy
   * ```
   */
  static merge<
    Item,
    Filter extends unknown,
    OrderBy extends unknown,
  >(
    ...lists: PaginatedList<Item, any, Filter, OrderBy>[]
  ): PaginatedList<Item, string, Filter, OrderBy> {
    class MergePaginatedList extends PaginatedList<Item, string, Filter, OrderBy> {
      override _getFirstCursor() { return JSON.stringify(lists.map(list => list.getFirstCursor())); }
      override _getLastCursor() { return JSON.stringify(lists.map(list => list.getLastCursor())); }
      override _compare(orderBy: OrderBy, a: Item, b: Item): number {
        const listsResults = lists.map(list => list.compare(orderBy, a, b));
        if (!listsResults.every(result => result === listsResults[0])) {
          throw new StackAssertionError("Lists have different compare results; make sure that they use the same compare function", { lists, listsResults, orderBy, a, b });
        }
        return listsResults[0];
      }

      override async _nextOrPrev(type: 'next' | 'prev', { limit, filter, orderBy, cursor }: ImplQueryOptions<'next' | 'prev', "first" | "last" | `[${string}]`, Filter, OrderBy>) {
        const cursors = JSON.parse(cursor);
        const fetchedLists = await Promise.all(lists.map(async (list, i) => {
          return await list.nextOrPrev(type, {
            limit,
            filter,
            orderBy,
            cursor: cursors[i],
            limitPrecision: "at-least",
          });
        }));
        const combinedItems = fetchedLists.flatMap((list, i) => list.items.map((itemEntry) => ({ itemEntry, listIndex: i })));
        const sortedItems = [...combinedItems].sort((a, b) => this._compare(orderBy, a.itemEntry.item, b.itemEntry.item));

        const sortedItemsWithMergedCursors: { item: Item, prevCursor: string, nextCursor: string }[] = [];
        const curCursors = [...cursors];
        // When going backward, we iterate in reverse order to correctly build cursors,
        // but we need to return items in ascending order
        for (const item of (type === 'next' ? sortedItems : sortedItems.reverse())) {
          const lastCursors = [...curCursors];
          curCursors[item.listIndex] = type === 'next' ? item.itemEntry.nextCursor : item.itemEntry.prevCursor;
          sortedItemsWithMergedCursors.push({
            item: item.itemEntry.item,
            prevCursor: type === 'next' ? JSON.stringify(lastCursors) : JSON.stringify(curCursors),
            nextCursor: type === 'next' ? JSON.stringify(curCursors) : JSON.stringify(lastCursors),
          });
        }

        // When going backward, reverse the result to maintain ascending order
        if (type === 'prev') {
          sortedItemsWithMergedCursors.reverse();
        }

        return {
          items: sortedItemsWithMergedCursors,
          isFirst: fetchedLists.every((list) => list.isFirst),
          isLast: fetchedLists.every((list) => list.isLast),
          cursor: JSON.stringify(curCursors),
        };
      }
    }
    return new MergePaginatedList();
  }

  /**
   * Returns an empty paginated list that always returns no items.
   *
   * @example
   * ```ts
   * const empty = PaginatedList.empty();
   * const result = await empty.next({ after: empty.getFirstCursor(), limit: 10, ... });
   * // result = { items: [], isFirst: true, isLast: true, cursor: "first" }
   * ```
   */
  static empty() {
    class EmptyPaginatedList extends PaginatedList<never, "first" | "last", any, any> {
      override _getFirstCursor() { return "first" as const; }
      override _getLastCursor() { return "last" as const; }
      override _compare(orderBy: any, a: any, b: any): number {
        return 0;
      }
      override async _nextOrPrev(type: 'next' | 'prev', options: ImplQueryOptions<'next' | 'prev', string, any, any>) {
        return { items: [], isFirst: true, isLast: true, cursor: "first" as const };
      }
    }
    return new EmptyPaginatedList();
  }
}

/**
 * A simple in-memory paginated list backed by an array.
 *
 * Filter is a predicate function, OrderBy is a comparator function.
 * Cursors are in the format "before-{index}" representing the position before that index.
 *
 * Note: This implementation re-filters and re-sorts the entire array on each query,
 * so it's only suitable for small datasets.
 *
 * @example
 * ```ts
 * const numbers = new ArrayPaginatedList([5, 2, 8, 1, 9, 3]);
 * const page = await numbers.next({
 *   after: "before-0",
 *   limit: 3,
 *   filter: (n) => n > 2,
 *   orderBy: (a, b) => a - b,
 *   limitPrecision: 'exact',
 * });
 * // page.items = [{ item: 3, prevCursor: "before-0", nextCursor: "before-1" }, { item: 5, prevCursor: "before-1", nextCursor: "before-2" }, ...]
 * ```
 */
export class ArrayPaginatedList<Item> extends PaginatedList<Item, `before-${number}`, (item: Item) => boolean, (a: Item, b: Item) => number> {
  constructor(private readonly array: Item[]) {
    super();
  }

  override _getFirstCursor() { return "before-0" as const; }
  override _getLastCursor() { return `before-${this.array.length}` as const; }
  override _compare(orderBy: (a: Item, b: Item) => number, a: Item, b: Item): number {
    return orderBy(a, b);
  }

  override async _nextOrPrev(type: 'next' | 'prev', options: ImplQueryOptions<'next' | 'prev', `before-${number}`, (item: Item) => boolean, (a: Item, b: Item) => number>) {
    // First filter and sort the entire array, THEN slice and assign cursors
    // This ensures pagination happens in the sorted/filtered result space
    const filteredArray = this.array.filter(options.filter);
    const sortedArray = [...filteredArray].sort((a, b) => this._compare(options.orderBy, a, b));

    // Assign cursors based on position in sorted/filtered result
    const itemEntriesArray = sortedArray.map((item, index) => ({
      item,
      prevCursor: `before-${index}` as `before-${number}`,
      nextCursor: `before-${index + 1}` as `before-${number}`,
    }));

    // Calculate slice boundaries based on cursor position in the sorted result
    const oldCursor = Number(options.cursor.replace("before-", ""));
    const clampedOldCursor = Math.max(0, Math.min(sortedArray.length, oldCursor));
    const newCursor = Math.max(0, Math.min(sortedArray.length, clampedOldCursor + (type === "next" ? 1 : -1) * options.limit));

    const slicedItemEntriesArray = itemEntriesArray.slice(Math.min(clampedOldCursor, newCursor), Math.max(clampedOldCursor, newCursor));

    return {
      items: slicedItemEntriesArray,
      isFirst: clampedOldCursor === 0 || newCursor === 0,
      isLast: clampedOldCursor === sortedArray.length || newCursor === sortedArray.length,
      cursor: `before-${newCursor}` as const,
    };
  }
}

