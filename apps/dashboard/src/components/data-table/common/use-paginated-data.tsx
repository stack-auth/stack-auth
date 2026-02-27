"use client";

import { useEffect, useMemo } from "react";
import { useCursorPaginationCache } from "./cursor-pagination";
import { useStableValue } from "./stable-value";

type QueryState = {
  page: number,
  pageSize: number,
  cursor?: string,
};

type UsePaginatedDataOptions<T, TExtended> = {
  data: T[],
  nextCursor: string | null,
  query: QueryState,
  getFingerprint: (data: T[], nextCursor: string | null) => string,
  extend?: (data: T[]) => TExtended[],
  onPrefetch?: (nextCursor: string) => void,
};

type UsePaginatedDataReturn<T> = {
  data: T[],
  nextCursor: string | null,
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  cursorForPage: (page: number) => string | null | undefined,
};

export function usePaginatedData<T, TExtended = T>(
  options: UsePaginatedDataOptions<T, TExtended>,
  cursorPaginationCache: ReturnType<typeof useCursorPaginationCache>,
): UsePaginatedDataReturn<TExtended> {
  const { data: rawData, nextCursor: rawNextCursor, query, getFingerprint, extend, onPrefetch } = options;
  const {
    readCursorForPage,
    recordPageCursor,
    recordNextCursor,
    prefetchCursor,
  } = cursorPaginationCache;

  const storedCursor = readCursorForPage(query.page);
  const cursorToUse = useMemo(() => {
    if (query.page === 1) {
      return undefined;
    }
    if (storedCursor && storedCursor.length > 0) {
      return storedCursor;
    }
    return storedCursor === null ? undefined : query.cursor;
  }, [query.page, query.cursor, storedCursor]);

  const fingerprint = useMemo(
    () => getFingerprint(rawData, rawNextCursor),
    [rawData, rawNextCursor, getFingerprint],
  );
  const stableData = useStableValue({ data: rawData, nextCursor: rawNextCursor }, fingerprint);
  const data = useMemo(
    () => (extend ? extend(stableData.data) : stableData.data) as TExtended[],
    [stableData.data, extend],
  );
  const nextCursor = stableData.nextCursor;

  useEffect(() => {
    recordPageCursor(query.page, query.page === 1 ? null : cursorToUse ?? null);
  }, [query.page, cursorToUse, recordPageCursor]);

  useEffect(() => {
    recordNextCursor(query.page, nextCursor);
  }, [query.page, nextCursor, recordNextCursor]);

  useEffect(() => {
    if (onPrefetch && nextCursor) {
      prefetchCursor(nextCursor, () => onPrefetch(nextCursor));
    }
  }, [nextCursor, onPrefetch, prefetchCursor]);

  return {
    data,
    nextCursor,
    hasNextPage: nextCursor !== null,
    hasPreviousPage: query.page > 1,
    cursorForPage: readCursorForPage,
  };
}

export function createSimpleFingerprint<T extends { id: string }>(
  data: T[],
  nextCursor: string | null,
): string {
  const ids = data.map((item) => item.id).join(",");
  return `${ids}|${nextCursor ?? "null"}`;
}
