// @vitest-environment jsdom

import type React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataGridColumnDef, DataGridState } from "@hexclave/dashboard-ui-components";
import PageClient from "./page-client";
import type { IssueListItem } from "./issues-data";

/**
 * Behavioural tests for the Issues list.
 *
 * The highest-value one is the N+1 guard: the page must issue **exactly one**
 * sparkline query per page of rows, carrying every visible hash. An N+1 there
 * turns a 50-row page into 51 requests and defeats the whole design, and it is
 * the kind of regression that looks fine in a browser with three seed rows.
 */

const HASHES = ["hash-a", "hash-b", "hash-c"];

function sampleIssue(index: number, overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id: `issue-${index}`,
    short_id: String(index),
    type: `TypeError${index}`,
    value: `boom ${index}`,
    culprit: `app/file-${index}.ts in run`,
    level: "error",
    status: "unresolved",
    substatus: "ongoing",
    first_seen_at_millis: 1_700_000_000_000,
    last_seen_at_millis: 1_700_000_900_000,
    times_seen: "12",
    window_occurrences: 4,
    window_users: 2,
    service_name: "web",
    environment: "production",
    release: null,
    handled: true,
    synthetic: false,
    counters_truncated_at_millis: null,
    updated_at_millis: 1_700_000_900_000,
    issue_hashes: [HASHES[index] ?? `hash-${index}`],
    ...overrides,
  };
}

const { adminApp, queryAnalyticsMock, sendInternalAdminRequestMock } = vi.hoisted(() => {
  const queryAnalytics = vi.fn();
  const sendInternalAdminRequest = vi.fn();
  return {
    adminApp: { projectId: "internal", queryAnalytics },
    queryAnalyticsMock: queryAnalytics,
    sendInternalAdminRequestMock: sendInternalAdminRequest,
  };
});

vi.mock("../../use-admin-app", () => ({
  useAdminApp: () => adminApp,
}));

vi.mock("../../app-enabled-guard", () => ({
  AppEnabledGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("../../sticky-page-header", () => ({
  StickyPageHeader: ({ title, actions }: { title: string, actions: React.ReactNode }) => (
    <header><h1>{title}</h1>{actions}</header>
  ),
}));

vi.mock("../../analytics/shared", () => ({
  AnalyticsEventLimitBanner: () => null,
  RowDetailField: () => null,
}));

vi.mock("@/components/router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRouterConfirm: () => ({ needConfirm: false }),
}));

// The real `Link` drives the URL prefetcher, which calls `adminApp.useProject()`
// — a hook the stub admin app above deliberately does not implement. A plain
// anchor keeps the assertion surface (hrefs) identical.
vi.mock("@/components/link", () => ({
  Link: ({ href, children, ...rest }: { href: string, children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  sendInternalAdminRequest: sendInternalAdminRequestMock,
}));

// The sparkline is reduced to a testid so "did the row render" and "did the
// chart resolve" are two separate, unambiguous assertions.
vi.mock("../event-sparkline", () => ({
  EventSparkline: ({ pending }: { pending?: boolean }) => (
    <div data-testid={pending === true ? "sparkline-pending" : "sparkline-loaded"} />
  ),
}));

/**
 * `DataGrid` is replaced with a flat renderer. Everything the page owns —
 * `useDataSource`, `useDataGridUrlState`, the column definitions, and every
 * `renderCell` — stays real; only the virtualizer is dropped, because in jsdom
 * it measures every element as zero-height and renders no rows at all, which
 * would make this file a test of the virtualizer's DOM stubs rather than of the
 * page.
 */
vi.mock("@hexclave/dashboard-ui-components", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const MockDataGrid = (props: {
    columns: readonly DataGridColumnDef<IssueListItem>[],
    rows: readonly IssueListItem[],
    getRowId: (row: IssueListItem) => string,
    isLoading?: boolean,
    emptyState?: React.ReactNode,
    state: DataGridState,
  }) => {
    if (props.isLoading === true) return <div data-testid="grid-loading" />;
    if (props.rows.length === 0) return <div data-testid="grid-empty">{props.emptyState}</div>;
    return (
      <table>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={props.getRowId(row)} data-testid={`row-${props.getRowId(row)}`}>
              {props.columns.map((column) => (
                <td key={column.id} data-testid={`cell-${props.getRowId(row)}-${column.id}`}>
                  {column.renderCell?.({
                    row,
                    rowId: props.getRowId(row),
                    rowIndex,
                    value: null,
                    columnId: column.id,
                    isSelected: false,
                    dateDisplay: "relative",
                  })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  return { ...actual, DataGrid: MockDataGrid };
});

function jsonResponse(body: unknown, ok = true): Response {
  // Only the three members the data layer reads. A full `Response` would need
  // jsdom's fetch polyfill for no additional coverage.
  const partial = {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
  return partial as unknown as Response;
}

function issueListBody(items: IssueListItem[]) {
  return {
    items,
    cursor: null,
    counts: { unresolved: items.length, resolved: 0, ignored: 0 },
    approximate: false,
  };
}

const SPARKLINE_MARKER = "issue_hash IN {issueHashes:Array(String)}";

function sparklineCalls() {
  return queryAnalyticsMock.mock.calls.filter(
    ([options]: [{ query: string }]) => options.query.includes(SPARKLINE_MARKER),
  );
}

function issueListCalls() {
  return sendInternalAdminRequestMock.mock.calls.filter(
    ([, path]: [unknown, string]) => path.startsWith("/internal/issues?"),
  );
}

describe("Issues page client", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/projects/internal/observability/issues");
  });

  afterEach(() => {
    cleanup();
    queryAnalyticsMock.mockReset();
    sendInternalAdminRequestMock.mockReset();
  });

  it("renders rows before the sparklines resolve", async () => {
    const issues = [sampleIssue(0), sampleIssue(1), sampleIssue(2)];
    sendInternalAdminRequestMock.mockResolvedValue(jsonResponse(issueListBody(issues)));
    queryAnalyticsMock.mockImplementation(async ({ query }: { query: string }) => {
      // The sparkline query never settles, standing in for a slow ClickHouse.
      if (query.includes(SPARKLINE_MARKER)) return await new Promise(() => {});
      return { result: [] };
    });

    render(<PageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("row-issue-0")).toBeDefined();
    });
    expect(screen.getByTestId("row-issue-1")).toBeDefined();
    expect(screen.getByTestId("row-issue-2")).toBeDefined();
    // Titles are real content, not placeholders.
    expect(screen.getByText("TypeError0")).toBeDefined();
    // ...and the charts are still hairlines.
    expect(screen.getAllByTestId("sparkline-pending")).toHaveLength(3);
    expect(screen.queryByTestId("sparkline-loaded")).toBeNull();
  });

  it("issues exactly ONE sparkline query per page, carrying every visible hash", async () => {
    const issues = [sampleIssue(0), sampleIssue(1), sampleIssue(2)];
    sendInternalAdminRequestMock.mockResolvedValue(jsonResponse(issueListBody(issues)));
    queryAnalyticsMock.mockImplementation(async ({ query }: { query: string }) => {
      if (!query.includes(SPARKLINE_MARKER)) return { result: [] };
      return {
        result: HASHES.map((hash) => ({
          issue_hash: hash,
          bucket_start: "2026-07-31 12:00:00.000",
          occurrences: 3,
        })),
      };
    });

    render(<PageClient />);

    await waitFor(() => {
      expect(screen.getAllByTestId("sparkline-loaded")).toHaveLength(3);
    });

    const calls = sparklineCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0].params.issueHashes).toEqual(HASHES);

    // Settle any effect the resolved cache scheduled — a per-row loader would
    // fire its extra queries here.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sparklineCalls()).toHaveLength(1);
  });

  it("applies a resolve optimistically without refetching the list", async () => {
    const issues = [sampleIssue(0)];
    sendInternalAdminRequestMock.mockImplementation(async (_app: unknown, path: string) => {
      if (path.startsWith("/internal/issues?")) return jsonResponse(issueListBody(issues));
      // The PATCH endpoint answers with `{ id, status }` only.
      return jsonResponse({ id: "issue-0", status: "resolved" });
    });
    queryAnalyticsMock.mockResolvedValue({ result: [] });

    render(<PageClient />);
    await waitFor(() => expect(screen.getByTestId("row-issue-0")).toBeDefined());

    const listCallsBefore = issueListCalls().length;
    expect(screen.getByTestId("cell-issue-0-status").textContent).toBe("—");

    screen.getByRole("button", { name: "Resolve" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("cell-issue-0-status").textContent).toBe("Resolved");
    });
    // The list is deliberately NOT refetched: under the Unresolved filter that
    // would yank the row out from under the cursor mid-scan.
    expect(issueListCalls()).toHaveLength(listCallsBefore);
  });

  it("reverts a failed resolve and surfaces an alert, never a toast", async () => {
    const issues = [sampleIssue(0)];
    sendInternalAdminRequestMock.mockImplementation(async (_app: unknown, path: string) => {
      if (path.startsWith("/internal/issues?")) return jsonResponse(issueListBody(issues));
      return jsonResponse({ message: "nope" }, false);
    });
    queryAnalyticsMock.mockResolvedValue({ result: [] });

    render(<PageClient />);
    await waitFor(() => expect(screen.getByTestId("row-issue-0")).toBeDefined());

    screen.getByRole("button", { name: "Resolve" }).click();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Couldn't update that issue");
    });
    // Reverted, not left optimistically resolved.
    expect(screen.getByTestId("cell-issue-0-status").textContent).toBe("—");
  });
});
