"use client";

import { useCallback, useRef } from "react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

export function useCursorPaginationCache(initialPage: number = 1) {
  const cursorCacheRef = useRef(new Map<number, string | null>([[initialPage, null]]));
  const prefetchedCursorRef = useRef(new Set<string>());

  const resetCache = useCallback(() => {
    cursorCacheRef.current = new Map<number, string | null>([[initialPage, null]]);
    prefetchedCursorRef.current.clear();
  }, [initialPage]);

  const readCursorForPage = useCallback((page: number): string | null | undefined => {
    return cursorCacheRef.current.get(page);
  }, []);

  const recordPageCursor = useCallback((page: number, cursor: string | null | undefined) => {
    cursorCacheRef.current.set(page, cursor ?? null);
  }, []);

  const recordNextCursor = useCallback((page: number, nextCursor: string | null | undefined) => {
    if (nextCursor) {
      cursorCacheRef.current.set(page + 1, nextCursor);
    } else {
      cursorCacheRef.current.delete(page + 1);
    }
  }, []);

  const prefetchCursor = useCallback((cursor: string | null | undefined, task: () => void | Promise<void>) => {
    if (!cursor) {
      return;
    }
    if (prefetchedCursorRef.current.has(cursor)) {
      return;
    }
    prefetchedCursorRef.current.add(cursor);
    runAsynchronously(task());
  }, []);

  return {
    resetCache,
    readCursorForPage,
    recordPageCursor,
    recordNextCursor,
    prefetchCursor,
  };
}

