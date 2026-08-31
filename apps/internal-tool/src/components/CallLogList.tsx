import { useState, useMemo, useEffect } from "react";
import { formatDistanceToNow, format } from "date-fns";
import type { McpCallLogRow } from "../types";
import { QA_REVIEW_FAILED_THRESHOLD_MS, qaReviewStartedAt, toDate } from "../utils";
import { reviewVisible } from "../lib/mcp-review-api";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Alert, Badge, Button, Card, cn, EmptyState, FieldLabel, Input, Pill, Select, tableClasses } from "./design";

// Matches MAX_BACKFILL_ITEMS in the backfill-visible route — one click enqueues
// at most this many reviews.
const MAX_REVIEW_BATCH = 50;

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

type SortField = "time" | "tool" | "steps" | "duration" | "qa" | "reviewed" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "ok" | "error";
type QaFilter = "all" | "pending" | "review-failed" | "pass" | "warn" | "fail" | "error" | "needs-review" | "human-reviewed" | "not-reviewed";

function isQaReviewFailed(row: McpCallLogRow): boolean {
  if (row.qaOverallScore != null || row.qaErrorMessage) return false;
  return Date.now() - qaReviewStartedAt(row).getTime() > QA_REVIEW_FAILED_THRESHOLD_MS;
}
const PAGE_SIZES = [25, 50, 100, 500] as const;
type PageSize = typeof PAGE_SIZES[number];

function getSortValue(row: McpCallLogRow, field: SortField): number | string {
  switch (field) {
    case "time": { return Number(row.id); }
    case "tool": { return row.toolName; }
    case "steps": { return row.stepCount; }
    case "duration": { return Number(row.durationMs); }
    case "qa": { return row.qaOverallScore ?? -1; }
    case "reviewed": { return row.humanReviewedAt ? Number(toDate(row.humanReviewedAt).getTime()) : 0; }
    case "status": { return row.errorMessage ? 1 : 0; }
  }
}

export function CallLogList({
  rows,
  connectionState,
  connectionErrorMessage,
  onSelect,
  selectedId,
}: {
  rows: McpCallLogRow[];
  connectionState: string;
  connectionErrorMessage: string | null;
  onSelect: (row: McpCallLogRow) => void;
  selectedId?: bigint;
}) {
  const [textFilter, setTextFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [qaFilter, setQaFilter] = useState<QaFilter>("all");
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toolNames = useMemo(() => {
    const names = new Set(rows.map(r => r.toolName));
    return Array.from(names).sort();
  }, [rows]);

  const [toolFilter, setToolFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [reviewing, setReviewing] = useState(false);
  const [justQueued, setJustQueued] = useState(false);

  const filteredAndSorted = useMemo(() => {
    let result = rows;

    // Text filter
    if (textFilter) {
      const lower = textFilter.toLowerCase();
      result = result.filter(
        r =>
          r.question.toLowerCase().includes(lower) ||
          r.reason.toLowerCase().includes(lower) ||
          r.response.toLowerCase().includes(lower)
      );
    }

    // Tool filter
    if (toolFilter !== "all") {
      result = result.filter(r => r.toolName === toolFilter);
    }

    // Status filter
    if (statusFilter === "ok") {
      result = result.filter(r => !r.errorMessage);
    } else if (statusFilter === "error") {
      result = result.filter(r => !!r.errorMessage);
    }

    // QA filter
    if (qaFilter === "pending") {
      result = result.filter(r => r.qaOverallScore == null && !r.qaErrorMessage && !isQaReviewFailed(r));
    } else if (qaFilter === "review-failed") {
      result = result.filter(r => isQaReviewFailed(r));
    } else if (qaFilter === "pass") {
      result = result.filter(r => r.qaOverallScore != null && r.qaOverallScore >= 80);
    } else if (qaFilter === "warn") {
      result = result.filter(r => r.qaOverallScore != null && r.qaOverallScore >= 50 && r.qaOverallScore < 80);
    } else if (qaFilter === "fail") {
      result = result.filter(r => r.qaOverallScore != null && r.qaOverallScore < 50);
    } else if (qaFilter === "error") {
      result = result.filter(r => !!r.qaErrorMessage);
    } else if (qaFilter === "needs-review") {
      result = result.filter(r => r.qaNeedsHumanReview);
    } else if (qaFilter === "human-reviewed") {
      result = result.filter(r => r.humanReviewedAt != null);
    } else if (qaFilter === "not-reviewed") {
      result = result.filter(r => r.humanReviewedAt == null && r.qaNeedsHumanReview);
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = getSortValue(a, sortField);
      const bVal = getSortValue(b, sortField);
      const cmp = typeof aVal === "string"
        ? (aVal < (bVal as string) ? -1 : aVal > (bVal as string) ? 1 : 0)
        : (aVal as number) - (bVal as number);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [rows, textFilter, toolFilter, statusFilter, qaFilter, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredAndSorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  // Rows on the current page that have never been auto-reviewed (qaReviewedAt is
  // null — including ones whose inline review failed and left no verdict). The
  // "Review visible" button backfills these; capped to the endpoint's batch max.
  const reviewableOnPage = pageRows
    .filter(r => r.qaReviewedAt == null)
    .slice(0, MAX_REVIEW_BATCH);

  const handleReviewVisible = async () => {
    if (reviewableOnPage.length === 0 || reviewing) return;
    setReviewing(true);
    try {
      await reviewVisible(reviewableOnPage.map(r => ({
        correlationId: r.correlationId,
        question: r.question,
        reason: r.reason,
        response: r.response,
      })));
      setJustQueued(true);
      setTimeout(() => setJustQueued(false), 3000);
    } catch (err) {
      captureError("internal-tool-review-visible", err);
    } finally {
      setReviewing(false);
    }
  };

  useEffect(() => {
    setPage(0);
  }, [textFilter, toolFilter, statusFilter, qaFilter, sortField, sortDir, pageSize]);

  if (connectionState === "connecting") {
    return <div className="p-4 text-sm text-muted-foreground">Connecting to SpacetimeDB...</div>;
  }

  if (connectionState === "error") {
    return (
      <Alert>
        <p>
          Failed to connect to SpacetimeDB. Check the browser session response below, then verify the{" "}
          <code>hexclave-ai-analytics</code> module is published and the local SpacetimeDB container is reachable.
        </p>
        {connectionErrorMessage != null && connectionErrorMessage !== "" && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs">
            {connectionErrorMessage}
          </pre>
        )}
      </Alert>
    );
  }

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="cursor-pointer select-none px-4 py-2 transition-colors hover:transition-none hover:text-foreground"
      onClick={() => handleSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>
        )}
      </span>
    </th>
  );

  const hasActiveFilters = textFilter || toolFilter !== "all" || statusFilter !== "all" || qaFilter !== "all";

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 space-y-2">
        <Input
          type="text"
          placeholder="Search question, reason, or response..."
          className="h-9 px-3 text-sm"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap items-center">
          {toolNames.length > 1 && (
            <Select
              className="w-auto"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
            >
              <option value="all">All tools</option>
              {toolNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          )}
          <Select
            className="w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All status</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </Select>
          <Select
            className="w-auto"
            value={qaFilter}
            onChange={(e) => setQaFilter(e.target.value as QaFilter)}
          >
            <option value="all">All QA</option>
            <option value="pending">Pending</option>
            <option value="review-failed">Review failed</option>
            <option value="pass">Pass (80+)</option>
            <option value="warn">Warning (50-79)</option>
            <option value="fail">Fail (&lt;50)</option>
            <option value="error">QA Error</option>
            <option value="needs-review">Needs Review</option>
            <option value="human-reviewed">Human Reviewed</option>
            <option value="not-reviewed">Not Yet Reviewed</option>
          </Select>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              onClick={() => {
                setTextFilter("");
                setToolFilter("all");
                setStatusFilter("all");
                setQaFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
          <Button
            className="ml-auto"
            onClick={() => { runAsynchronously(handleReviewVisible); }}
            disabled={reviewableOnPage.length === 0 || reviewing}
            title="Run the automated QA review for the not-yet-reviewed rows on this page. Runs in the background."
          >
            {reviewing
              ? "Queuing…"
              : justQueued
                ? "Queued ✓"
                : reviewableOnPage.length === 0
                  ? "All reviewed"
                  : `Review ${reviewableOnPage.length} on page`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {filteredAndSorted.length} of {rows.length} calls
          </span>
        </div>
      </div>

      {filteredAndSorted.length === 0 ? (
        <Card>
          <EmptyState className="py-12">
            {hasActiveFilters ? (
              <p className="text-sm">No calls match the current filters</p>
            ) : (
              <p className="text-lg">No MCP calls logged yet</p>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Card bodyClassName="p-0" className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className={cn(tableClasses.headRow, "bg-panel text-left")}>
                <SortHeader field="time">Time</SortHeader>
                <SortHeader field="tool">Tool</SortHeader>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Question</th>
                <SortHeader field="steps">Steps</SortHeader>
                <SortHeader field="duration">Duration</SortHeader>
                <SortHeader field="qa">QA</SortHeader>
                <SortHeader field="reviewed">Human Reviewed</SortHeader>
                <SortHeader field="status">Status</SortHeader>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={String(row.id)}
                  onClick={() => onSelect(row)}
                  className={cn(tableClasses.bodyRow, selectedId === row.id && tableClasses.selectedRow)}
                >
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground" title={format(toDate(row.createdAt), "PPpp")}>
                    {formatDistanceToNow(toDate(row.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2">
                    <Badge color="purple">{row.toolName}</Badge>
                  </td>
                  <td className="max-w-[200px] px-4 py-2 text-muted-foreground" title={row.reason}>
                    {truncate(row.reason, 60)}
                  </td>
                  <td className="max-w-[300px] px-4 py-2 text-foreground" title={row.question}>
                    {truncate(row.question, 80)}
                  </td>
                  <td className="px-4 py-2 text-center text-muted-foreground tabular-nums">{row.stepCount}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground tabular-nums">
                    {Number(row.durationMs).toLocaleString()}ms
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1">
                      {row.qaErrorMessage ? (
                        <Badge color="red">err</Badge>
                      ) : row.qaOverallScore != null ? (
                        <Badge color={row.qaOverallScore >= 80 ? "green" : row.qaOverallScore >= 50 ? "orange" : "red"}>
                          {row.qaOverallScore}
                          {row.qaNeedsHumanReview && !row.humanReviewedAt && " !"}
                        </Badge>
                      ) : isQaReviewFailed(row) ? (
                        <Badge color="orange" title="Review didn't complete — open the row to retry">
                          review failed
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground" title="Review in progress">…</span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {row.humanReviewedAt ? (
                      <Badge
                        color="green"
                        title={`Reviewed ${format(toDate(row.humanReviewedAt), "PPpp")}${row.humanReviewedBy ? ` by ${row.humanReviewedBy}` : ""}`}
                      >
                        &#10003; {formatDistanceToNow(toDate(row.humanReviewedAt), { addSuffix: true })}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge color={row.errorMessage ? "red" : "green"}>{row.errorMessage ? "error" : "ok"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <FieldLabel>Page size</FieldLabel>
              {PAGE_SIZES.map(s => (
                <Pill key={s} active={pageSize === s} onClick={() => setPageSize(s)}>{s}</Pill>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {filteredAndSorted.length === 0
                  ? "No results"
                  : `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filteredAndSorted.length)} of ${filteredAndSorted.length}`}
              </span>
              <Button size="xs" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>
                Prev
              </Button>
              <span className="font-mono tabular-nums text-muted-foreground">{currentPage + 1} / {pageCount}</span>
              <Button size="xs" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
