import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";

// Binary search: index of the first item whose id > cursor, in an
// array already sorted by `stringCompare(a.id, b.id)`.
function firstIndexAfter<T extends { id: string }>(sorted: T[], cursor: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (stringCompare(sorted[mid].id, cursor) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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

export const permissionDefinitionsListQuerySchema = yupObject({
  limit: yupNumber().integer().min(1).max(200).optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Maximum number of items to return (capped at 200). When set, the response is paginated via cursor." } }),
  cursor: yupString().optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Cursor (permission id) to start the next page from. Requires `limit` to also be set." } }),
  query: yupString().optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Free-text filter applied to permission id and description (case-insensitive)." } }),
});

export function paginatePermissionDefinitions(items: PermissionDefinition[], query: ListQuery) {
  if (query.cursor != null && query.limit === undefined) {
    throw new StatusError(StatusError.BadRequest, "`cursor` requires `limit` to also be set.");
  }

  const search = query.query?.trim().toLowerCase();
  const filtered = (search
    ? items.filter((p) =>
      p.id.toLowerCase().includes(search)
      || (p.description?.toLowerCase().includes(search) ?? false))
    : items.slice()
  ).sort((a, b) => stringCompare(a.id, b.id));

  if (query.limit === undefined) {
    return { items: filtered, is_paginated: false as const };
  }

  let startIdx = 0;
  if (query.cursor != null) {
    const cursorIdx = filtered.findIndex((p) => p.id === query.cursor);
    // If the cursor row was deleted (or filtered out) between page
    // requests, fall back to "first id strictly greater than the cursor"
    // rather than 400'ing the client mid-scroll. Worst case the user
    // sees a one-row gap; the alternative is a hard error on infinite
    // scroll for any concurrent edit.
    startIdx = cursorIdx === -1
      ? firstIndexAfter(filtered, query.cursor)
      : cursorIdx + 1;
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
