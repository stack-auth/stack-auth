import { range } from "./arrays";
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

type QueryResult<Item, Cursor> = { items: { item: Item, itemCursor: Cursor }[], isFirst: boolean, isLast: boolean, cursor: Cursor }

type ImplQueryResult<Item, Cursor> = { items: { item: Item, itemCursor: Cursor }[], isFirst: boolean, isLast: boolean, cursor: Cursor }

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
  public getFirstCursor(): Cursor { return this._getFirstCursor(); }
  public getLastCursor(): Cursor { return this._getLastCursor(); }
  public compare(orderBy: OrderBy, a: Item, b: Item): number { return this._compare(orderBy, a, b); }

  async nextOrPrev(type: 'next' | 'prev', options: QueryOptions<'next' | 'prev', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    let result: { item: Item, itemCursor: Cursor }[] = [];
    let includesFirst = false;
    let includesLast = false;
    let cursor = options.cursor;
    let limitRemaining = options.limit;
    while (limitRemaining > 0 || (type === "next" && includesLast) || (type === "prev" && includesFirst)) {
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
        if (options.limit > 0) cursor = result[result.length - 1].itemCursor;
      } else {
        result = result.slice(result.length - options.limit);
        includesFirst = false;
        if (options.limit > 0) cursor = result[0].itemCursor;
      }
    }
    return { items: result, isFirst: includesFirst, isLast: includesLast, cursor };
  }
  public async next({ after, ...rest }: QueryOptions<'next', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    return await this.nextOrPrev("next", {
      ...rest,
      cursor: after,
    });
  }
  public async prev({ before, ...rest }: QueryOptions<'prev', Cursor, Filter, OrderBy>): Promise<QueryResult<Item, Cursor>> {
    return await this.nextOrPrev("prev", {
      ...rest,
      cursor: before,
    });
  }

  // Utility methods below

  flatMap<Item2, Cursor2 extends string, Filter2 extends unknown, OrderBy2 extends unknown>(options: {
    itemMapper: (itemEntry: { item: Item, itemCursor: Cursor }, filter: Filter2, orderBy: OrderBy2) => { item: Item2, itemCursor: Cursor2 }[],
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

  map<Item2, Filter2 extends unknown, OrderBy2 extends unknown>(options: {
    itemMapper: (item: Item) => Item2,
    oldItemFromNewItem: (item: Item2) => Item,
    oldFilterFromNewFilter: (filter: Filter2) => Filter,
    oldOrderByFromNewOrderBy: (orderBy: OrderBy2) => OrderBy,
  }): PaginatedList<Item2, Cursor, Filter2, OrderBy2> {
    return this.flatMap({
      itemMapper: (itemEntry, filter, orderBy) => {
        return [{ item: options.itemMapper(itemEntry.item), itemCursor: itemEntry.itemCursor }];
      },
      compare: (orderBy, a, b) => this.compare(options.oldOrderByFromNewOrderBy(orderBy), options.oldItemFromNewItem(a), options.oldItemFromNewItem(b)),
      newCursorFromOldCursor: (cursor) => cursor,
      oldCursorFromNewCursor: (cursor) => cursor,
      oldFilterFromNewFilter: (filter) => options.oldFilterFromNewFilter(filter),
      oldOrderByFromNewOrderBy: (orderBy) => options.oldOrderByFromNewOrderBy(orderBy),
      estimateItemsToFetch: (options) => options.limit,
    });
  }

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
          throw new StackAssertionError("Lists have different compare results; make sure that they use the same compare function", { lists, listsResults });
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
        const lastCursorForEachList = sortedItems.reduce((acc, item) => {
          acc[item.listIndex] = item.itemEntry.itemCursor;
          return acc;
        }, range(lists.length).map((i) => cursors[i]));
        return {
          items: sortedItems.map((item) => item.itemEntry),
          isFirst: sortedItems.every((item) => item.listIndex === 0),
          isLast: sortedItems.every((item) => item.listIndex === lists.length - 1),
          cursor: JSON.stringify(lastCursorForEachList),
        };
      }
    }
    return new MergePaginatedList();
  }

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

export class ArrayPaginatedList<Item> extends PaginatedList<Item, `${number}`, (item: Item) => boolean, (a: Item, b: Item) => number> {
  constructor(private readonly array: Item[]) {
    super();
  }

  override _getFirstCursor() { return "0" as const; }
  override _getLastCursor() { return `${this.array.length - 1}` as const; }
  override _compare(orderBy: (a: Item, b: Item) => number, a: Item, b: Item): number {
    return orderBy(a, b);
  }

  override async _nextOrPrev(type: 'next' | 'prev', options: ImplQueryOptions<'next' | 'prev', `${number}`, (item: Item) => boolean, (a: Item, b: Item) => number>) {
    const filteredArray = this.array.filter(options.filter);
    const sortedArray = [...filteredArray].sort((a, b) => this._compare(options.orderBy, a, b));
    const itemEntriesArray = sortedArray.map((item, index) => ({ item, itemCursor: `${index}` as const }));
    const oldCursor = Number(options.cursor);
    const newCursor = Math.max(0, Math.min(this.array.length - 1, oldCursor + (type === "next" ? 1 : -1) * options.limit));
    return {
      items: itemEntriesArray.slice(Math.min(oldCursor, newCursor), Math.max(oldCursor, newCursor)),
      isFirst: oldCursor === 0 || newCursor === 0,
      isLast: oldCursor === this.array.length - 1 || newCursor === this.array.length - 1,
      cursor: `${newCursor}` as const,
    };
  }
}
