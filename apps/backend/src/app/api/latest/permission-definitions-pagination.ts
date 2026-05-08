import { KnownErrors } from "@stackframe/stack-shared";

type PermissionDefinition = {
  id: string,
  description?: string,
  contained_permission_ids: string[],
};

type ListQuery = {
  limit?: number,
  cursor?: string,
  query?: string,
};

/**
 * Permission definitions live in tenancy config rather than a DB table, so
 * paginating them means filtering and slicing the in-memory list returned by
 * `listPermissionDefinitions`. The list is already sorted by id, which makes
 * the id a stable cursor.
 *
 * Cursor convention: `cursor` is the id of the last item returned on the
 * previous page; the next page starts immediately after it. If the cursor
 * isn't present in the filtered list (e.g. the caller's `query` filter
 * changed across pages) we throw rather than silently returning an empty
 * page — that way the caller learns to reset their pagination state.
 */
export function paginatePermissionDefinitions(items: PermissionDefinition[], query: ListQuery) {
  const search = query.query?.trim().toLowerCase();
  const filtered = search
    ? items.filter((p) =>
      p.id.toLowerCase().includes(search)
      || (p.description?.toLowerCase().includes(search) ?? false))
    : items;

  if (query.limit === undefined) {
    return { items: filtered, is_paginated: false as const };
  }

  let startIdx = 0;
  if (query.cursor) {
    const cursorIdx = filtered.findIndex((p) => p.id === query.cursor);
    if (cursorIdx === -1) {
      throw new KnownErrors.ItemNotFound(query.cursor);
    }
    startIdx = cursorIdx + 1;
  }
  const slice = filtered.slice(startIdx, startIdx + query.limit);
  const hasMore = startIdx + query.limit < filtered.length;

  return {
    items: slice,
    is_paginated: true as const,
    pagination: {
      next_cursor: hasMore && slice.length > 0 ? slice[slice.length - 1].id : null,
    },
  };
}
