import { useState, useMemo, useEffect } from "react";
import { formatDistanceToNow, format } from "date-fns";
import type { McpCallLogRow } from "../types";
import { toDate } from "../utils";
import { clsx } from "clsx";

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

type SortField = "time" | "tool" | "steps" | "duration" | "qa" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "ok" | "error";
type QaFilter = "all" | "pending" | "pass" | "warn" | "fail" | "error" | "needs-review" | "human-reviewed" | "not-reviewed";
const PAGE_SIZES = [25, 50, 100, 500] as const;
type PageSize = typeof PAGE_SIZES[number];

function getSortValue(row: McpCallLogRow, field: SortField): number | string {
  switch (field) {
    case "time": { return Number(row.id); }
    case "tool": { return row.toolName; }
    case "steps": { return row.stepCount; }
    case "duration": { return Number(row.durationMs); }
    case "qa": { return row.qaOverallScore ?? -1; }
    case "status": { return row.errorMessage ? 1 : 0; }
  }
}

export function CallLogList({
  rows,
  connectionState,
  onSelect,
  selectedId,
}: {
  rows: McpCallLogRow[];
  connectionState: string;
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
      result = result.filter(r => r.qaOverallScore == null && !r.qaErrorMessage);
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

  useEffect(() => {
    setPage(0);
  }, [textFilter, toolFilter, statusFilter, qaFilter, sortField, sortDir, pageSize]);

  if (connectionState === "connecting") {
    return <div className="text-gray-500 text-sm p-4">Connecting to SpacetimeDB...</div>;
  }

  if (connectionState === "error") {
    return (
      <div className="text-red-600 text-sm p-4">
        Failed to connect to SpacetimeDB. Check that <code>NEXT_PUBLIC_SPACETIMEDB_HOST</code> and{" "}
        <code>NEXT_PUBLIC_SPACETIMEDB_DB_NAME</code> are set correctly.
      </div>
    );
  }

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="px-4 py-2 cursor-pointer hover:text-gray-700 select-none"
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
        <input
          type="text"
          placeholder="Search question, reason, or response..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap items-center">
          {toolNames.length > 1 && (
            <select
              className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
            >
              <option value="all">All tools</option>
              {toolNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          <select
            className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All status</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
          <select
            className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
            value={qaFilter}
            onChange={(e) => setQaFilter(e.target.value as QaFilter)}
          >
            <option value="all">All QA</option>
            <option value="pending">Pending</option>
            <option value="pass">Pass (80+)</option>
            <option value="warn">Warning (50-79)</option>
            <option value="fail">Fail (&lt;50)</option>
            <option value="error">QA Error</option>
            <option value="needs-review">Needs Review</option>
            <option value="human-reviewed">Human Reviewed</option>
            <option value="not-reviewed">Not Yet Reviewed</option>
          </select>
          {hasActiveFilters && (
            <button
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
              onClick={() => {
                setTextFilter("");
                setToolFilter("all");
                setStatusFilter("all");
                setQaFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {filteredAndSorted.length} of {rows.length} calls
          </span>
        </div>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          {hasActiveFilters ? (
            <p className="text-sm">No calls match the current filters</p>
          ) : (
            <>
              <p className="text-lg mb-2">No MCP calls logged yet</p>
              <p className="text-sm">
                Make sure <code className="bg-gray-100 px-1 rounded">STACK_MCP_LOG_TOKEN</code> is set
                in the backend and the SpacetimeDB module is published.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                <SortHeader field="time">Time</SortHeader>
                <SortHeader field="tool">Tool</SortHeader>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Question</th>
                <SortHeader field="steps">Steps</SortHeader>
                <SortHeader field="duration">Duration</SortHeader>
                <SortHeader field="qa">QA</SortHeader>
                <SortHeader field="status">Status</SortHeader>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={String(row.id)}
                  onClick={() => onSelect(row)}
                  className={clsx(
                    "cursor-pointer border-t border-gray-100 hover:bg-blue-50 transition-colors",
                    selectedId === row.id && "bg-blue-50"
                  )}
                >
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500" title={format(toDate(row.createdAt), "PPpp")}>
                    {formatDistanceToNow(toDate(row.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                      {row.toolName}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600 max-w-[200px]" title={row.reason}>
                    {truncate(row.reason, 60)}
                  </td>
                  <td className="px-4 py-2 text-gray-900 max-w-[300px]" title={row.question}>
                    {truncate(row.question, 80)}
                  </td>
                  <td className="px-4 py-2 text-center text-gray-500">{row.stepCount}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {Number(row.durationMs).toLocaleString()}ms
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1">
                      {row.qaErrorMessage ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          err
                        </span>
                      ) : row.qaOverallScore != null ? (
                        <span className={clsx(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                          row.qaOverallScore >= 80 && "bg-green-100 text-green-800",
                          row.qaOverallScore >= 50 && row.qaOverallScore < 80 && "bg-yellow-100 text-yellow-800",
                          row.qaOverallScore < 50 && "bg-red-100 text-red-800"
                        )}>
                          {row.qaOverallScore}
                          {row.qaNeedsHumanReview && !row.humanReviewedAt && " !"}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">--</span>
                      )}
                      {row.humanReviewedAt && (
                        <span className="text-green-600 text-xs" title={`Reviewed by ${row.humanReviewedBy}`}>&#10003;</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {row.errorMessage ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                        error
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        ok
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 text-xs text-gray-600 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Page size</span>
              {PAGE_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => setPageSize(s)}
                  className={clsx(
                    "px-2 py-0.5 text-xs rounded",
                    pageSize === s ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">
                {filteredAndSorted.length === 0
                  ? "No results"
                  : `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filteredAndSorted.length)} of ${filteredAndSorted.length}`}
              </span>
              <button
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="px-2 py-0.5 text-xs rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white"
              >
                Prev
              </button>
              <span className="text-gray-500 font-mono">{currentPage + 1} / {pageCount}</span>
              <button
                onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                disabled={currentPage >= pageCount - 1}
                className="px-2 py-0.5 text-xs rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
