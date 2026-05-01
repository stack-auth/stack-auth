import { useEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual"
import { CaretDownIcon, CaretUpIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export type VirtualDataGridColumn<TItem, TSortId extends string> = {
  id: string,
  label: string,
  width: string,
  sortable?: TSortId,
  headerClassName?: string,
  cellClassName?: string,
  renderCell: (item: TItem, index: number) => ReactNode,
  renderSkeleton?: () => ReactNode,
}

export type VirtualDataGridSort<TSortId extends string> = {
  id: TSortId,
  desc: boolean,
}

export type VirtualDataGridProps<TItem, TSortId extends string> = {
  columns: ReadonlyArray<VirtualDataGridColumn<TItem, TSortId>>,
  items: ReadonlyArray<TItem>,
  getItemKey: (item: TItem) => string,
  totalCount?: number,
  rowHeight?: number,
  isLoading: boolean,
  skeletonRows?: number,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => Promise<unknown> | void,
  searchValue?: string,
  onSearchValueChange?: (value: string) => void,
  searchPlaceholder?: string,
  headerAccessory?: ReactNode,
  isSearching: boolean,
  emptyMessage: string,
  sort?: VirtualDataGridSort<TSortId>,
  onSortChange?: (id: TSortId) => void,
  selectedItemKey?: string | null,
  onSelectItemKey?: (key: string) => void,
  onRowClick?: (item: TItem, index: number) => void,
  rowClassName?: string | ((item: TItem, index: number) => string | undefined),
  keyboardNavigationDisabled?: boolean,
  className?: string,
  frameClassName?: string,
  tableClassName?: string,
  stickyTopClassName?: string,
  scrollMode?: "page" | "container",
}

const DEFAULT_ROW_HEIGHT = 64
const DEFAULT_SKELETON_ROWS = 8
const GRID_CELL_CLASS = "flex min-w-0 items-center px-4"

export function VirtualDataGrid<TItem, TSortId extends string>({
  columns,
  items,
  getItemKey: getItemKeyForItem,
  totalCount,
  rowHeight = DEFAULT_ROW_HEIGHT,
  isLoading,
  skeletonRows = DEFAULT_SKELETON_ROWS,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  searchValue,
  onSearchValueChange,
  searchPlaceholder,
  headerAccessory,
  isSearching,
  emptyMessage,
  sort,
  onSortChange,
  selectedItemKey,
  onSelectItemKey,
  onRowClick,
  rowClassName,
  keyboardNavigationDisabled = false,
  className,
  frameClassName,
  tableClassName,
  stickyTopClassName = "top-0",
  scrollMode = "page",
}: VirtualDataGridProps<TItem, TSortId>) {
  const gridTemplateColumns = useMemo(
    () => columns.map((column) => column.width).join(" "),
    [columns],
  )
  const [bodyScrollMargin, setBodyScrollMargin] = useState(0)
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const loadedRowCount = items.length + (hasNextPage ? 1 : 0)
  const virtualRowCount = totalCount == null
    ? loadedRowCount
    : Math.max(totalCount, loadedRowCount)
  const getVirtualItemKey = (index: number) => {
    const item = items[index]
    return item == null ? `__loader_${index}` : getItemKeyForItem(item)
  }
  const pageVirtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: virtualRowCount,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: bodyScrollMargin,
    getItemKey: getVirtualItemKey,
    enabled: scrollMode === "page",
  })
  const containerVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: virtualRowCount,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: getVirtualItemKey,
    enabled: scrollMode === "container",
  })
  const virtualizer = scrollMode === "container" ? containerVirtualizer : pageVirtualizer
  const rowScrollMargin = scrollMode === "container" ? 0 : bodyScrollMargin
  const stickyTop = scrollMode === "container" ? "top-0" : stickyTopClassName
  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()
  const showEmptyMessage = isSearching && items.length === 0 && !hasNextPage

  useEffect(() => {
    const updateBodyScrollMargin = () => {
      const body = bodyRef.current
      if (body == null) return

      setBodyScrollMargin(body.getBoundingClientRect().top + window.scrollY)
    }

    updateBodyScrollMargin()
    window.addEventListener("resize", updateBodyScrollMargin)
    return () => window.removeEventListener("resize", updateBodyScrollMargin)
  }, [isLoading, isSearching, items.length, setBodyScrollMargin, virtualRowCount])

  useEffect(() => {
    if (virtualItems.length === 0) return

    const lastVirtualItem = virtualItems[virtualItems.length - 1]
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      lastVirtualItem.index >= items.length - 5
    ) {
      const fetchResult = fetchNextPage()
      if (fetchResult != null) runAsynchronously(fetchResult)
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, items.length, virtualItems])

  useEffect(() => {
    if (keyboardNavigationDisabled) return

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

      if (event.key === "j" || event.key === "n") {
        event.preventDefault()
        selectKeyboardItem(1, items, selectedItemKey ?? null, getItemKeyForItem, onSelectItemKey, virtualizer)
      } else if (event.key === "k") {
        event.preventDefault()
        selectKeyboardItem(-1, items, selectedItemKey ?? null, getItemKeyForItem, onSelectItemKey, virtualizer)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [
    getItemKeyForItem,
    items,
    keyboardNavigationDisabled,
    onSelectItemKey,
    selectedItemKey,
    virtualizer,
  ])

  return (
    <div className={cn("min-w-0 max-w-full", frameClassName, className)}>
      <div
        ref={scrollElementRef}
        className={cn(
          "w-full min-w-0 max-w-full text-xs",
          scrollMode === "container" && "h-full min-h-0 overflow-auto",
          tableClassName,
        )}
      >
        <VirtualDataGridHeader
          columns={columns}
          gridTemplateColumns={gridTemplateColumns}
          searchValue={searchValue}
          onSearchValueChange={onSearchValueChange}
          searchPlaceholder={searchPlaceholder}
          headerAccessory={headerAccessory}
          sort={sort}
          onSortChange={onSortChange}
          stickyTopClassName={stickyTop}
        />

        {isLoading ? (
          <VirtualDataGridSkeleton
            columns={columns}
            gridTemplateColumns={gridTemplateColumns}
            rowHeight={rowHeight}
            rows={skeletonRows}
          />
        ) : (
          <div
            ref={bodyRef}
            className="relative"
            role="rowgroup"
            style={{ height: showEmptyMessage ? undefined : `${totalHeight}px` }}
          >
            {showEmptyMessage ? (
              <div className="py-12 text-center text-sm text-muted-foreground" role="row">
                {emptyMessage}
              </div>
            ) : virtualItems.map((virtualRow) => {
              if (virtualRow.index >= items.length) {
                return (
                  <VirtualDataGridUnloadedRow
                    key={`__loader_${virtualRow.index}`}
                    index={virtualRow.index}
                    isFirstUnloadedRow={virtualRow.index === items.length}
                    isLoading={isFetchingNextPage || hasNextPage}
                    measureElement={virtualizer.measureElement}
                    rowHeight={rowHeight}
                    virtualStart={virtualRow.start}
                    scrollMargin={rowScrollMargin}
                  />
                )
              }

              const item = items[virtualRow.index]
              const itemKey = getItemKeyForItem(item)
              return (
                <VirtualDataGridRow
                  key={itemKey}
                  columns={columns}
                  gridTemplateColumns={gridTemplateColumns}
                  item={item}
                  index={virtualRow.index}
                  selected={selectedItemKey === itemKey}
                  onSelect={onSelectItemKey == null ? undefined : () => onSelectItemKey(itemKey)}
                  onRowClick={onRowClick}
                  rowClassName={rowClassName}
                  measureElement={virtualizer.measureElement}
                  rowHeight={rowHeight}
                  virtualStart={virtualRow.start}
                  scrollMargin={rowScrollMargin}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function VirtualDataGridUnloadedRow({
  index,
  isFirstUnloadedRow,
  isLoading,
  measureElement,
  rowHeight,
  virtualStart,
  scrollMargin,
}: {
  index: number,
  isFirstUnloadedRow: boolean,
  isLoading: boolean,
  measureElement: (node: HTMLDivElement | null) => void,
  rowHeight: number,
  virtualStart: number,
  scrollMargin: number,
}) {
  return (
    <div
      data-index={index}
      ref={measureElement}
      className="absolute left-0 top-0 flex w-full items-center justify-center text-xs text-muted-foreground"
      style={{
        height: rowHeight,
        transform: `translateY(${virtualStart - scrollMargin}px)`,
      }}
      role="row"
    >
      {isFirstUnloadedRow && isLoading ? "Loading more..." : null}
    </div>
  )
}

function VirtualDataGridHeader<TItem, TSortId extends string>({
  columns,
  gridTemplateColumns,
  searchValue,
  onSearchValueChange,
  searchPlaceholder,
  headerAccessory,
  sort,
  onSortChange,
  stickyTopClassName,
}: {
  columns: ReadonlyArray<VirtualDataGridColumn<TItem, TSortId>>,
  gridTemplateColumns: string,
  searchValue?: string,
  onSearchValueChange?: (value: string) => void,
  searchPlaceholder?: string,
  headerAccessory?: ReactNode,
  sort?: VirtualDataGridSort<TSortId>,
  onSortChange?: (id: TSortId) => void,
  stickyTopClassName: string,
}) {
  const showSearch = searchValue != null && onSearchValueChange != null && searchPlaceholder != null
  return (
    <div
      className={cn("sticky z-20 bg-muted/95 backdrop-blur", stickyTopClassName)}
      role="rowgroup"
    >
      {showSearch ? (
        <div className="grid h-[52px] border-b" style={{ gridTemplateColumns }} role="row">
          <div className={cn(GRID_CELL_CLASS, "justify-between gap-3 py-2 [grid-column:1/-1]")}>
            <div className="relative w-full max-w-sm">
              <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchValueChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 ps-8"
              />
            </div>
            {headerAccessory == null ? null : (
              <div className="shrink-0">{headerAccessory}</div>
            )}
          </div>
        </div>
      ) : null}
      <div
        className="grid h-10 border-b font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
        style={{ gridTemplateColumns }}
        role="row"
      >
        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(GRID_CELL_CLASS, "font-medium", column.headerClassName)}
            role="columnheader"
            aria-sort={column.sortable == null || sort == null ? undefined : getColumnAriaSort(sort, column.sortable)}
          >
            {column.sortable == null ? (
              <span className={column.id === "actions" ? "sr-only" : "truncate"}>
                {column.label}
              </span>
            ) : sort != null && onSortChange != null ? (
              <SortableVirtualDataGridHeader
                columnId={column.sortable}
                label={column.label}
                sort={sort}
                onSortChange={onSortChange}
              />
            ) : (
              <span className="truncate">{column.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function VirtualDataGridSkeleton<TItem, TSortId extends string>({
  columns,
  gridTemplateColumns,
  rowHeight,
  rows,
}: {
  columns: ReadonlyArray<VirtualDataGridColumn<TItem, TSortId>>,
  gridTemplateColumns: string,
  rowHeight: number,
  rows: number,
}) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid border-b"
          style={{ gridTemplateColumns, height: rowHeight }}
        >
          {columns.map((column) => (
            <div key={column.id} className={cn(GRID_CELL_CLASS, column.cellClassName)}>
              {column.renderSkeleton?.() ?? <Skeleton className="h-4 w-24" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SortableVirtualDataGridHeader<TSortId extends string>({
  columnId,
  label,
  sort,
  onSortChange,
}: {
  columnId: TSortId,
  label: string,
  sort: VirtualDataGridSort<TSortId>,
  onSortChange: (id: TSortId) => void,
}) {
  const isActive = sort.id === columnId
  return (
    <button
      type="button"
      onClick={() => onSortChange(columnId)}
      className="inline-flex min-w-0 items-center gap-1 rounded-sm text-start font-medium hover:text-foreground hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{label}</span>
      {isActive && !sort.desc ? (
        <CaretUpIcon className="size-3 shrink-0" weight="bold" />
      ) : isActive && sort.desc ? (
        <CaretDownIcon className="size-3 shrink-0" weight="bold" />
      ) : (
        <CaretDownIcon className="size-3 shrink-0 opacity-35" />
      )}
    </button>
  )
}

function VirtualDataGridRow<TItem, TSortId extends string>({
  columns,
  gridTemplateColumns,
  item,
  index,
  selected,
  onSelect,
  onRowClick,
  rowClassName,
  measureElement,
  rowHeight,
  virtualStart,
  scrollMargin,
}: {
  columns: ReadonlyArray<VirtualDataGridColumn<TItem, TSortId>>,
  gridTemplateColumns: string,
  item: TItem,
  index: number,
  selected: boolean,
  onSelect?: () => void,
  onRowClick?: (item: TItem, index: number) => void,
  rowClassName?: string | ((item: TItem, index: number) => string | undefined),
  measureElement: (node: HTMLDivElement | null) => void,
  rowHeight: number,
  virtualStart: number,
  scrollMargin: number,
}) {
  const interactive = onSelect != null || onRowClick != null
  const handleSelect = () => {
    onSelect?.()
    onRowClick?.(item, index)
  }

  return (
    <div
      data-index={index}
      ref={measureElement}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleSelect : undefined}
      onKeyDown={(event) => {
        if (!interactive) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          handleSelect()
        }
      }}
      className={cn(
        "absolute left-0 top-0 grid w-full border-b text-left outline-none transition-colors hover:bg-muted/50 hover:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        interactive && "cursor-pointer",
        selected && "bg-muted/70",
        typeof rowClassName === "function" ? rowClassName(item, index) : rowClassName,
      )}
      aria-current={selected ? "true" : undefined}
      style={{
        gridTemplateColumns,
        height: rowHeight,
        transform: `translateY(${virtualStart - scrollMargin}px)`,
      }}
      role="row"
    >
      {columns.map((column) => (
        <div
          key={column.id}
          className={cn(GRID_CELL_CLASS, column.cellClassName)}
          role="cell"
        >
          {column.renderCell(item, index)}
        </div>
      ))}
    </div>
  )
}

function getColumnAriaSort<TSortId extends string>(
  sort: VirtualDataGridSort<TSortId>,
  columnId: TSortId,
) {
  if (sort.id !== columnId) return "none"
  return sort.desc ? "descending" : "ascending"
}

function selectKeyboardItem<TItem>(
  direction: 1 | -1,
  items: ReadonlyArray<TItem>,
  selectedItemKey: string | null,
  getItemKey: (item: TItem) => string,
  onSelectItemKey: ((key: string) => void) | undefined,
  virtualizer: {
    scrollToIndex: (
      index: number,
      options?: { align?: "auto" | "start" | "center" | "end" },
    ) => void,
  },
) {
  if (onSelectItemKey == null) return
  if (items.length === 0) return

  const selectedIndex = selectedItemKey == null
    ? -1
    : items.findIndex((item) => getItemKey(item) === selectedItemKey)
  const nextIndex = selectedIndex === -1
    ? direction === 1 ? 0 : items.length - 1
    : selectedIndex + direction

  if (nextIndex < 0 || nextIndex >= items.length) return

  onSelectItemKey(getItemKey(items[nextIndex]))
  virtualizer.scrollToIndex(nextIndex, { align: "auto" })
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
