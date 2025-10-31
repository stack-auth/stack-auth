"use client";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@stackframe/stack-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { combineClassNames } from "./manual-table";

type ManualPaginationControlsProps = {
  page: number,
  pageSize: number,
  pageSizeOptions: number[],
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  onNextPage: () => void,
  onPreviousPage: () => void,
  onPageSizeChange: (pageSize: number) => void,
  pageSizeLabel?: string,
  pageIndicatorLabel?: (page: number) => ReactNode,
  className?: string,
  selectAriaLabel?: string,
};

const defaultIndicator = (page: number) => <>Page {page}</>;

export function ManualPaginationControls(props: ManualPaginationControlsProps) {
  const {
    page,
    pageSize,
    pageSizeOptions,
    hasNextPage,
    hasPreviousPage,
    onNextPage,
    onPreviousPage,
    onPageSizeChange,
    pageSizeLabel = "Rows per page",
    pageIndicatorLabel = defaultIndicator,
    className,
    selectAriaLabel,
  } = props;

  return (
    <div className={combineClassNames("flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{pageSizeLabel}</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="w-20" aria-label={selectAriaLabel ?? `${pageSizeLabel}: ${pageSize}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onPreviousPage} disabled={!hasPreviousPage}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <span className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground">
          {pageIndicatorLabel(page)}
        </span>
        <Button variant="ghost" size="sm" onClick={onNextPage} disabled={!hasNextPage}>
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

