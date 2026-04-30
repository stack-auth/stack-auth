import * as React from "react"

import type {UseInfiniteVirtualListOptions} from "@/hooks/use-infinite-virtual-list";
import { cn } from "@/lib/utils"
import {
  
  useInfiniteVirtualList
} from "@/hooks/use-infinite-virtual-list"

type RenderItem<TItem> = (args: {
  item: TItem,
  index: number,
}) => React.ReactNode

type InfiniteVirtualListProps<TItem, TCursor> = UseInfiniteVirtualListOptions<TItem, TCursor> & {
  renderItem: RenderItem<TItem>,
  getItemKey?: (item: TItem, index: number) => string | number,
  className?: string,
  innerClassName?: string,
  itemClassName?: string,
  emptyState?: React.ReactNode,
  loadingState?: React.ReactNode,
  errorState?: (error: unknown, retry: () => void) => React.ReactNode,
  loadingMore?: React.ReactNode,
}

export function InfiniteVirtualList<TItem, TCursor = string>(
  props: InfiniteVirtualListProps<TItem, TCursor>,
) {
  const {
    renderItem,
    getItemKey,
    className,
    innerClassName,
    itemClassName,
    emptyState,
    loadingState,
    errorState,
    loadingMore,
    ...hookOptions
  } = props

  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteVirtualList(hookOptions)

  if (isLoading) {
    return (
      <div className={cn("relative overflow-auto", className)}>
        {loadingState ?? <DefaultLoading />}
      </div>
    )
  }

  if (isError) {
    return (
      <div className={cn("relative overflow-auto", className)}>
        {errorState
          ? errorState(error, () => refetch())
          : <DefaultError onRetry={() => refetch()} />}
      </div>
    )
  }

  if (items.length === 0 && !hasNextPage) {
    return (
      <div className={cn("relative overflow-auto", className)}>
        {emptyState ?? <DefaultEmpty />}
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className={cn("relative overflow-auto", className)}>
      <div
        className={cn("relative w-full", innerClassName)}
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((row) => {
          const isLoaderRow = row.index >= items.length
          const item = items[row.index]
          const key = isLoaderRow
            ? `__loader_${row.index}`
            : getItemKey
              ? getItemKey(item, row.index)
              : row.key
          return (
            <div
              key={key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className={cn("absolute left-0 top-0 w-full", itemClassName)}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {isLoaderRow
                ? (loadingMore ?? (
                    <DefaultLoadingMore visible={isFetchingNextPage || hasNextPage} />
                  ))
                : renderItem({ item, index: row.index })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DefaultLoading() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center py-10 text-sm">
      Loading…
    </div>
  )
}

function DefaultLoadingMore({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="text-muted-foreground flex items-center justify-center py-4 text-xs">
      Loading more…
    </div>
  )
}

function DefaultEmpty() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center py-10 text-sm">
      No results
    </div>
  )
}

function DefaultError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-destructive flex h-full flex-col items-center justify-center gap-2 py-10 text-sm">
      <span>Failed to load.</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-foreground underline underline-offset-4"
      >
        Retry
      </button>
    </div>
  )
}
