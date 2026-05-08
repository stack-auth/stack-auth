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

  const startIdx = query.cursor
    ? filtered.findIndex((p) => p.id === query.cursor) + 1 || filtered.length
    : 0;
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
