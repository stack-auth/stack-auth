import { useCallback, useEffect, useMemo, useRef } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises"
import type { InfiniteData, QueryFunctionContext, QueryKey  } from "@tanstack/react-query"
import type { Virtualizer } from "@tanstack/react-virtual"

export type InfiniteVirtualPage<TItem, TCursor> = {
  items: Array<TItem>,
  nextCursor?: TCursor | null,
}

export type InfiniteVirtualQueryFn<TItem, TCursor> = (
  ctx: QueryFunctionContext<QueryKey, TCursor | undefined>,
) => Promise<InfiniteVirtualPage<TItem, TCursor>>

export type UseInfiniteVirtualListOptions<TItem, TCursor> = {
  queryKey: QueryKey,
  queryFn: InfiniteVirtualQueryFn<TItem, TCursor>,
  initialPageParam?: TCursor,
  estimateSize: number | ((index: number) => number),
  overscan?: number,
  enabled?: boolean,
  staleTime?: number,
  gcTime?: number,
  /** Distance in items from the end at which to prefetch the next page. Default 5. */
  prefetchThreshold?: number,
  /** When provided, virtualizer uses this scroll element instead of the internal parent ref. */
  getScrollElement?: () => HTMLElement | null,
  /** Estimated size cache key — set when the row component changes shape. */
  measureKey?: string,
  keyboardNavigation?: {
    enabled?: boolean,
    selectedIndex?: number | null,
    getSelectedIndex?: (items: ReadonlyArray<TItem>) => number | null,
    onSelectedIndexChange?: (index: number) => void,
    onSelectedItemChange?: (item: TItem, index: number) => void,
    /**
     * Item indexes that keyboard navigation may select. Defaults to every
     * loaded item, but filtered lists should pass their visible indexes.
     */
    selectableIndexes?: ReadonlyArray<number> | ((items: ReadonlyArray<TItem>) => ReadonlyArray<number>),
    nextKey?: string,
    previousKey?: string,
  },
}

export type UseInfiniteVirtualListResult<TItem> = {
  parentRef: React.RefObject<HTMLDivElement>,
  virtualizer: Virtualizer<HTMLElement, Element>,
  items: Array<TItem>,
  isLoading: boolean,
  isError: boolean,
  error: unknown,
  isFetchingNextPage: boolean,
  hasNextPage: boolean,
  fetchNextPage: () => void,
  refetch: () => void,
}

export function useInfiniteVirtualList<TItem, TCursor = string>(
  options: UseInfiniteVirtualListOptions<TItem, TCursor>,
): UseInfiniteVirtualListResult<TItem> {
  const {
    queryKey,
    queryFn,
    initialPageParam,
    estimateSize,
    overscan = 8,
    enabled = true,
    staleTime,
    gcTime,
    prefetchThreshold = 5,
    getScrollElement,
    measureKey,
    keyboardNavigation,
  } = options

  const parentRef = useRef<HTMLDivElement>(null)
  const pendingKeyboardNavigationRef = useRef<{ direction: 1 | -1, fromIndex: number } | null>(null)

  const query = useInfiniteQuery<
    InfiniteVirtualPage<TItem, TCursor>,
    Error,
    InfiniteData<InfiniteVirtualPage<TItem, TCursor>, TCursor | undefined>,
    QueryKey,
    TCursor | undefined
  >({
    queryKey,
    queryFn,
    initialPageParam: initialPageParam,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime,
    gcTime,
  })

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )

  const hasNextPage = !!query.hasNextPage
  const count = items.length + (hasNextPage ? 1 : 0)

  const estimateSizeFn = useCallback(
    (index: number) => (typeof estimateSize === "function" ? estimateSize(index) : estimateSize),
    [estimateSize],
  )

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: getScrollElement ?? (() => parentRef.current),
    estimateSize: estimateSizeFn,
    overscan,
  })

  const fetchNextPage = useCallback(() => {
    runAsynchronously(query.fetchNextPage())
  }, [query])

  // Recompute sizes when the consumer signals rows changed shape.
  useEffect(() => {
    if (measureKey !== undefined) virtualizer.measure()
  }, [measureKey, virtualizer])

  // Trigger next-page fetch when the last visible item nears the end.
  const virtualItems = virtualizer.getVirtualItems()
  useEffect(() => {
    if (virtualItems.length === 0) return
    const last = virtualItems[virtualItems.length - 1]
    if (
      hasNextPage &&
      !query.isFetchingNextPage &&
      last.index >= items.length - prefetchThreshold
    ) {
      fetchNextPage()
    }
  }, [virtualItems, hasNextPage, query.isFetchingNextPage, items.length, prefetchThreshold, fetchNextPage])

  const defaultSelectableIndexes = useMemo(
    () => items.map((_, index) => index),
    [items],
  )
  const keyboardNavigationEnabled = keyboardNavigation?.enabled ?? false
  const selectedKeyboardIndex = keyboardNavigation?.getSelectedIndex?.(items)
    ?? keyboardNavigation?.selectedIndex
    ?? null
  const onSelectedKeyboardIndexChange = keyboardNavigation?.onSelectedIndexChange
  const onSelectedKeyboardItemChange = keyboardNavigation?.onSelectedItemChange
  const configuredSelectableIndexes = keyboardNavigation?.selectableIndexes
  const selectableIndexes = useMemo(() => {
    if (typeof configuredSelectableIndexes === "function") {
      return configuredSelectableIndexes(items)
    }
    return configuredSelectableIndexes ?? defaultSelectableIndexes
  }, [configuredSelectableIndexes, defaultSelectableIndexes, items])
  const nextKey = keyboardNavigation?.nextKey ?? "j"
  const previousKey = keyboardNavigation?.previousKey ?? "k"

  const selectKeyboardIndex = useCallback((index: number) => {
    const item = items[index]
    if (
      item == null ||
      (onSelectedKeyboardIndexChange == null && onSelectedKeyboardItemChange == null)
    ) {
      return
    }
    onSelectedKeyboardIndexChange?.(index)
    onSelectedKeyboardItemChange?.(item, index)
    virtualizer.scrollToIndex(index, { align: "auto" })
  }, [items, onSelectedKeyboardIndexChange, onSelectedKeyboardItemChange, virtualizer])

  const navigateKeyboardSelection = useCallback((direction: 1 | -1) => {
    if (
      !keyboardNavigationEnabled ||
      (onSelectedKeyboardIndexChange == null && onSelectedKeyboardItemChange == null)
    ) {
      return
    }

    if (selectableIndexes.length === 0) {
      if (direction === 1 && hasNextPage) {
        pendingKeyboardNavigationRef.current = { direction, fromIndex: -1 }
        if (!query.isFetchingNextPage) fetchNextPage()
      }
      return
    }

    const selectedPosition = selectedKeyboardIndex == null
      ? -1
      : selectableIndexes.indexOf(selectedKeyboardIndex)

    if (selectedPosition === -1) {
      selectKeyboardIndex(direction === 1 ? selectableIndexes[0] : selectableIndexes[selectableIndexes.length - 1])
      return
    }

    const nextPosition = selectedPosition + direction
    if (nextPosition >= 0 && nextPosition < selectableIndexes.length) {
      selectKeyboardIndex(selectableIndexes[nextPosition])
      return
    }

    if (direction === 1 && hasNextPage) {
      pendingKeyboardNavigationRef.current = {
        direction,
        fromIndex: selectableIndexes[selectedPosition],
      }
      if (!query.isFetchingNextPage) fetchNextPage()
    }
  }, [
    keyboardNavigationEnabled,
    onSelectedKeyboardIndexChange,
    onSelectedKeyboardItemChange,
    selectableIndexes,
    selectedKeyboardIndex,
    hasNextPage,
    query.isFetchingNextPage,
    fetchNextPage,
    selectKeyboardIndex,
  ])

  useEffect(() => {
    if (!keyboardNavigationEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTextEntryTarget(event.target)
      ) {
        return
      }

      if (event.key === nextKey) {
        event.preventDefault()
        navigateKeyboardSelection(1)
      } else if (event.key === previousKey) {
        event.preventDefault()
        navigateKeyboardSelection(-1)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [keyboardNavigationEnabled, nextKey, previousKey, navigateKeyboardSelection])

  useEffect(() => {
    if (!keyboardNavigationEnabled || query.isFetchingNextPage) return

    const pending = pendingKeyboardNavigationRef.current
    if (pending == null) return

    const nextIndex = pending.direction === 1
      ? selectableIndexes.find((index) => index > pending.fromIndex)
      : findLastIndexBefore(selectableIndexes, pending.fromIndex)

    if (nextIndex != null) {
      pendingKeyboardNavigationRef.current = null
      selectKeyboardIndex(nextIndex)
      return
    }

    if (pending.direction === 1 && hasNextPage) {
      fetchNextPage()
      return
    }

    pendingKeyboardNavigationRef.current = null
  }, [
    keyboardNavigationEnabled,
    query.isFetchingNextPage,
    selectableIndexes,
    hasNextPage,
    fetchNextPage,
    selectKeyboardIndex,
  ])

  return {
    parentRef,
    virtualizer,
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: query.refetch,
  }
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.closest("[role='textbox']") != null
  )
}

function findLastIndexBefore(indexes: ReadonlyArray<number>, fromIndex: number) {
  for (let i = indexes.length - 1; i >= 0; i--) {
    const index = indexes[i]
    if (index < fromIndex) return index
  }
  return undefined
}
