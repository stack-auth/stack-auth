import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

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
  if (query.cursor && query.limit === undefined) {
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
  if (query.cursor) {
    const cursorIdx = filtered.findIndex((p) => p.id === query.cursor);
    if (cursorIdx === -1) {
      throw new StatusError(StatusError.BadRequest, `Cursor not found: ${query.cursor}`);
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
