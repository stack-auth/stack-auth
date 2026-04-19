"use client";

import { DesignBadge, DesignCard } from "@/components/design-components";
import { cn } from "@/components/ui";
import {
  CaretRightIcon,
  ClipboardTextIcon,
  CursorClickIcon,
  LightningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useMemo, useRef, useState } from "react";
import { PageLayout } from "../../page-layout";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridCellContext,
  type DataGridDataSource,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import {
  DEMO_COLUMNS,
  DEMO_USERS_200,
  DEMO_USERS_10K,
  type User,
} from "./demo/fixtures";

// ─── Layout helpers ──────────────────────────────────────────────────

function SectionHeading({ index, label, caption }: { index: string; label: string; caption: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 tabular-nums">{index}</span>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{label}</h3>
          <p className="text-[11px] mt-0.5 truncate text-muted-foreground">{caption}</p>
        </div>
      </div>
    </div>
  );
}

function Accordion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-3">
      <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors list-none [&::-webkit-details-marker]:hidden">
        <CaretRightIcon className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" weight="bold" />
        {label}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

// ─── Event log ───────────────────────────────────────────────────────

type LabEvent = { id: number; ts: number; name: string; payload: string };

function useEventLog() {
  const [events, setEvents] = useState<LabEvent[]>([]);
  const idRef = useRef(0);
  const log = useCallback((name: string, payload: string) => {
    setEvents((prev) => {
      idRef.current += 1;
      return [{ id: idRef.current, ts: Date.now(), name, payload }, ...prev].slice(0, 30);
    });
  }, []);
  const clear = useCallback(() => setEvents([]), []);
  return { events, log, clear };
}

function EventsPanel({ events, onClear }: { events: LabEvent[]; onClear: () => void }) {
  return (
    <DesignCard
      title="Callback events"
      icon={LightningIcon}
      actions={
        <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30" onClick={onClear} disabled={events.length === 0}>
          <XIcon weight="bold" className="h-3 w-3" /> Clear
        </button>
      }
    >
      {events.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
          Interact with the grid and callbacks fire here.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-foreground/[0.05] rounded-lg bg-foreground/[0.02] ring-1 ring-foreground/[0.05] max-h-[220px] overflow-y-auto">
          {events.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 px-3 py-1.5">
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 shrink-0 w-[60px]">
                {new Date(e.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className="font-mono text-[11px] font-semibold text-foreground shrink-0">{e.name}</span>
              <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground max-w-[220px]">{e.payload}</span>
            </li>
          ))}
        </ol>
      )}
    </DesignCard>
  );
}

// ─── Usage code panel ────────────────────────────────────────────────

function UsagePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <DesignCard
      title="Usage"
      icon={ClipboardTextIcon}
      actions={
        <button
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            runAsynchronouslyWithAlert(async () => {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          <CursorClickIcon weight="bold" className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      }
    >
      <pre className="overflow-x-auto rounded-lg bg-foreground/[0.04] p-3 font-mono text-[11px] leading-[1.55] text-foreground ring-1 ring-foreground/[0.06] max-h-[220px]">
        <code>{code}</code>
      </pre>
    </DesignCard>
  );
}

// ─── Usage code generation ───────────────────────────────────────────

function genUsage(label: string, state: DataGridState, opts: { paginationMode: string; selectionMode: string; dataSource?: boolean }) {
  const lines = [
    `const [state, setState] = useState(() =>`,
    `  createDefaultDataGridState(columns),`,
    `);`,
    ``,
    `<DataGrid`,
    `  columns={columns}`,
    opts.dataSource ? `  dataSource={fetchUsers}` : `  data={users}`,
    `  getRowId={(row) => row.id}`,
    `  state={state}`,
    `  onChange={setState}`,
    `  paginationMode="${opts.paginationMode}"`,
    `  selectionMode="${opts.selectionMode}"`,
  ];
  if (state.sorting.length > 0) lines.push(`  // sort: ${state.sorting.map((s) => `${s.columnId} ${s.direction}`).join(", ")}`);
  if (state.selection.selectedIds.size > 0) lines.push(`  // selected: ${state.selection.selectedIds.size} row(s)`);
  lines.push(
    `  onRowClick={(row, id) => { /* ... */ }}`,
    `  onSelectionChange={(ids, rows) => { /* ... */ }}`,
    `/>`,
  );
  return lines.join("\n");
}

// ─── Wired onChange that logs diffs ──────────────────────────────────

function useTrackedState(
  init: () => DataGridState,
  log: (name: string, payload: string) => void,
): [DataGridState, React.Dispatch<React.SetStateAction<DataGridState>>] {
  const [state, setState] = useState(init);
  const tracked = useCallback<React.Dispatch<React.SetStateAction<DataGridState>>>(
    (action) => {
      setState((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        if (next.sorting !== prev.sorting) log("onSortChange", JSON.stringify(next.sorting));
        if (next.quickSearch !== prev.quickSearch) log("onQuickSearch", `"${next.quickSearch}"`);
        if (next.selection !== prev.selection)
          log("onSelectionChange", `${next.selection.selectedIds.size} row(s)`);
        if (next.columnWidths !== prev.columnWidths) {
          const k = Object.keys(next.columnWidths).find((k) => next.columnWidths[k] !== prev.columnWidths[k]);
          if (k) log("onColumnResize", `${k}=${next.columnWidths[k]}px`);
        }
        if (next.columnVisibility !== prev.columnVisibility)
          log("onColumnVisibility", JSON.stringify(next.columnVisibility));
        if (next.pagination !== prev.pagination)
          log("onPaginationChange", `page=${next.pagination.pageIndex + 1}, pageSize=${next.pagination.pageSize}`);
        return next;
      });
    },
    [log],
  );
  return [state, tracked];
}

// ─── Columns with cell callbacks ─────────────────────────────────────

function useColumnsWithCallbacks(log: (n: string, p: string) => void) {
  return useMemo(
    () =>
      DEMO_COLUMNS.map((col) => ({
        ...col,
        onCellClick: (ctx: DataGridCellContext<User>) => log(`cell:click:${col.id}`, `row=${ctx.rowId}`),
        onCellDoubleClick: (ctx: DataGridCellContext<User>) => log(`cell:dblclick:${col.id}`, `row=${ctx.rowId}`),
      })),
    [log],
  );
}

// ─── Async data source ───────────────────────────────────────────────

function createAsyncDataSource(allData: User[]): DataGridDataSource<User> {
  return async function* (params) {
    await new Promise((r) => setTimeout(r, 600));
    let sorted = [...allData];
    if (params.sorting.length > 0) {
      const s = params.sorting[0]!;
      sorted.sort((a, b) => {
        const va = a[s.columnId as keyof User], vb = b[s.columnId as keyof User];
        let c = 0;
        if (typeof va === "number" && typeof vb === "number") c = va - vb;
        else if (va instanceof Date && vb instanceof Date) c = va.getTime() - vb.getTime();
        else c = String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
        return s.direction === "asc" ? c : -c;
      });
    }
    const ps = params.pagination.pageSize, st = params.pagination.pageIndex * ps;
    const page = sorted.slice(st, st + ps);
    yield { rows: page, totalRowCount: sorted.length, hasMore: st + ps < sorted.length, nextCursor: st + ps < sorted.length ? st + ps : undefined };
  };
}

// ─── Height edge case helper ─────────────────────────────────────────

/**
 * Renders a single DataGrid inside a parent with a specific height
 * constraint, plus a caption describing what's being tested. Used by the
 * "Height edge cases" section to exercise every combination of parent
 * height × `maxHeight` prop × row count.
 */
function HeightCase({
  index,
  title,
  expectation,
  data,
  maxHeight,
  parentClassName,
  toolbar,
  footer,
  wrapInFlex,
}: {
  index: string;
  title: string;
  expectation: string;
  data: User[];
  maxHeight?: number | string;
  parentClassName?: string;
  toolbar?: false;
  footer?: false;
  /** When true, wrap the grid in an extra `flex-1 min-h-0` child so the
   *  `parentClassName` acts as a flex column with the grid as flex item. */
  wrapInFlex?: boolean;
}) {
  const [state, setState] = useState(() => createDefaultDataGridState(DEMO_COLUMNS));
  const ds = useDataSource({
    data,
    columns: DEMO_COLUMNS,
    getRowId: (r: User) => r.id,
    sorting: state.sorting,
    quickSearch: state.quickSearch,
    pagination: state.pagination,
    paginationMode: "client",
  });

  const grid = (
    <DataGrid<User>
      columns={DEMO_COLUMNS}
      rows={ds.rows}
      getRowId={(row) => row.id}
      totalRowCount={ds.totalRowCount}
      isLoading={ds.isLoading}
      state={state}
      onChange={setState}
      paginationMode="paginated"
      selectionMode="none"
      maxHeight={maxHeight}
      toolbar={toolbar}
      footer={footer}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground/60">{index}</span>
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">{expectation}</p>
      <div
        className={cn(
          "rounded-xl ring-1 ring-dashed ring-foreground/10 bg-foreground/[0.015] p-2",
          parentClassName,
        )}
      >
        {wrapInFlex ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 px-2 pb-2 font-mono text-[10px] text-muted-foreground/70">
              sibling · shrink-0
            </div>
            <div className="flex-1 min-h-0">{grid}</div>
          </div>
        ) : (
          grid
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export default function PageClient() {
  // ── Section 1: Client-side ─────────────────────────────────
  const log1 = useEventLog();
  const cols1 = useColumnsWithCallbacks(log1.log);
  const [s1, setS1] = useTrackedState(() => createDefaultDataGridState(DEMO_COLUMNS), log1.log);
  const ds1 = useDataSource({ data: DEMO_USERS_200, columns: DEMO_COLUMNS, getRowId: (r: User) => r.id, sorting: s1.sorting, quickSearch: s1.quickSearch, pagination: s1.pagination, paginationMode: "client" });
  const usage1 = useMemo(() => genUsage("Client", s1, { paginationMode: "paginated", selectionMode: "multiple" }), [s1]);

  // ── Section 2: Infinite scroll ─────────────────────────────
  const log2 = useEventLog();
  const cols2 = useColumnsWithCallbacks(log2.log);
  const [s2, setS2] = useTrackedState(() => ({ ...createDefaultDataGridState(DEMO_COLUMNS), pagination: { pageIndex: 0, pageSize: 50 } }), log2.log);
  const ds2Source = useMemo(() => createAsyncDataSource(DEMO_USERS_10K), []);
  const ds2 = useDataSource({ dataSource: ds2Source, getRowId: (r: User) => r.id, columns: DEMO_COLUMNS, sorting: s2.sorting, quickSearch: s2.quickSearch, pagination: s2.pagination, paginationMode: "infinite" });
  const usage2 = useMemo(() => genUsage("Infinite", s2, { paginationMode: "infinite", selectionMode: "none", dataSource: true }), [s2]);

  // ── Section 3: Server pagination ───────────────────────────
  const log3 = useEventLog();
  const cols3 = useColumnsWithCallbacks(log3.log);
  const [s3, setS3] = useTrackedState(() => ({ ...createDefaultDataGridState(DEMO_COLUMNS), pagination: { pageIndex: 0, pageSize: 25 } }), log3.log);
  const ds3Source = useMemo(() => createAsyncDataSource(DEMO_USERS_10K), []);
  const ds3 = useDataSource({ dataSource: ds3Source, getRowId: (r: User) => r.id, columns: DEMO_COLUMNS, sorting: s3.sorting, quickSearch: s3.quickSearch, pagination: s3.pagination, paginationMode: "server" });
  const usage3 = useMemo(() => genUsage("Server", s3, { paginationMode: "paginated", selectionMode: "single", dataSource: true }), [s3]);

  // ── Section 4: Selection ───────────────────────────────────
  const log4 = useEventLog();
  const cols4 = useColumnsWithCallbacks(log4.log);
  const [s4, setS4] = useTrackedState(() => createDefaultDataGridState(DEMO_COLUMNS), log4.log);
  const ds4 = useDataSource({ data: DEMO_USERS_200.slice(0, 50), columns: DEMO_COLUMNS, getRowId: (r: User) => r.id, sorting: s4.sorting, quickSearch: s4.quickSearch, pagination: s4.pagination, paginationMode: "client" });
  const usage4 = useMemo(() => genUsage("Selection", s4, { paginationMode: "paginated", selectionMode: "multiple" }), [s4]);

  return (
    <PageLayout
      title="DataGrid interaction lab"
      description="Virtualized data grid with resizable columns, infinite scroll, quick search, sorting, selection, cell callbacks, and CSV export."
      actions={<DesignBadge label="Lab · internal" color="purple" icon={LightningIcon} size="sm" />}
    >
      <div className="flex flex-col gap-8">
        {/* ── 01 Client-side ───────────────────────────────────── */}
        <section>
          <SectionHeading index="01" label="Client-side · 200 rows · cell callbacks" caption="All callbacks wired — search, click cells, sort, resize, select" />
          <DataGrid<User>
            columns={cols1}
            rows={ds1.rows}
            getRowId={(row) => row.id}
            totalRowCount={ds1.totalRowCount}
            isLoading={ds1.isLoading}
            state={s1}
            onChange={setS1}
            paginationMode="paginated"
            selectionMode="multiple"
            maxHeight={520}
            exportFilename="users-client"
            onRowClick={(row, id) => log1.log("onRowClick", `${id} (${row.name})`)}
            onRowDoubleClick={(row, id) => log1.log("onRowDoubleClick", `${id} (${row.name})`)}
          />
          <Accordion label="Usage & callback log">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <UsagePanel code={usage1} />
              <EventsPanel events={log1.events} onClear={log1.clear} />
            </div>
          </Accordion>
        </section>

        {/* ── 02 Infinite scroll ────────────────────────────────── */}
        <section>
          <SectionHeading index="02" label="Infinite scroll · 10K rows" caption="Async generator yields pages as you scroll — virtualized rendering for performance" />
          <DataGrid<User>
            columns={cols2}
            rows={ds2.rows}
            getRowId={(row) => row.id}
            totalRowCount={ds2.totalRowCount}
            isLoading={ds2.isLoading}
            isLoadingMore={ds2.isLoadingMore}
            hasMore={ds2.hasMore}
            onLoadMore={ds2.loadMore}
            state={s2}
            onChange={setS2}
            paginationMode="infinite"
            selectionMode="none"
            maxHeight={480}
            exportFilename="users-infinite"
            onRowClick={(row, id) => log2.log("onRowClick", `${id} (${row.name})`)}
          />
          <Accordion label="Usage & callback log">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <UsagePanel code={usage2} />
              <EventsPanel events={log2.events} onClear={log2.clear} />
            </div>
          </Accordion>
        </section>

        {/* ── 03 Server pagination ──────────────────────────────── */}
        <section>
          <SectionHeading index="03" label="Server pagination · 10K rows" caption="Page-by-page server fetching with async data source — 25 rows per page" />
          <DataGrid<User>
            columns={cols3}
            rows={ds3.rows}
            getRowId={(row) => row.id}
            totalRowCount={ds3.totalRowCount}
            isLoading={ds3.isLoading}
            isRefetching={ds3.isRefetching}
            state={s3}
            onChange={setS3}
            paginationMode="paginated"
            selectionMode="single"
            maxHeight={480}
            exportFilename="users-server"
            onRowClick={(row, id) => log3.log("onRowClick", `${id} (${row.name})`)}
          />
          <Accordion label="Usage & callback log">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <UsagePanel code={usage3} />
              <EventsPanel events={log3.events} onClear={log3.clear} />
            </div>
          </Accordion>
        </section>

        {/* ── 04 Selection ──────────────────────────────────────── */}
        <section>
          <SectionHeading index="04" label="Multi-select · click / ctrl / shift" caption="Click to select, Ctrl+Click to toggle, Shift+Click for range — checkbox column included" />
          <DataGrid<User>
            columns={cols4}
            rows={ds4.rows}
            getRowId={(row) => row.id}
            totalRowCount={ds4.totalRowCount}
            isLoading={ds4.isLoading}
            state={s4}
            onChange={setS4}
            paginationMode="paginated"
            selectionMode="multiple"
            maxHeight={400}
            footer={false}
            onRowClick={(row, id) => log4.log("onRowClick", `${id} (${row.name})`)}
            onSelectionChange={(ids, rows) => log4.log("onSelectionChange", `${ids.size} row(s): ${rows.slice(0, 3).map((r) => r.name).join(", ")}${rows.length > 3 ? "\u2026" : ""}`)}
          />
          <Accordion label="Usage & callback log">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <UsagePanel code={usage4} />
              <EventsPanel events={log4.events} onClear={log4.clear} />
            </div>
          </Accordion>
        </section>

        {/* ── 05 Height edge cases ─────────────────────────────── */}
        <section>
          <SectionHeading
            index="05"
            label="Height edge cases"
            caption="Every combination of parent height × maxHeight × row count — the grid should do the right thing in each"
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <HeightCase
              index="05.A"
              title="Unbounded parent · no maxHeight · few rows"
              expectation="Parent is auto-height. No maxHeight. 5 rows. Grid grows to fit its content; no scrollbar. Page does not scroll either because the grid is shorter than the viewport."
              data={DEMO_USERS_200.slice(0, 5)}
            />

            <HeightCase
              index="05.B"
              title="Unbounded parent · no maxHeight · many rows"
              expectation="Parent is auto-height. No maxHeight. 200 rows. Grid grows to its full content height and the PAGE scrolls. Not ideal for production, but the grid itself shouldn't crash or collapse."
              data={DEMO_USERS_200}
            />

            <HeightCase
              index="05.C"
              title="Unbounded parent · maxHeight={360}"
              expectation="Parent is auto-height. Grid caps at 360px via the prop and scrolls its body. Toolbar and footer remain visible."
              data={DEMO_USERS_200}
              maxHeight={360}
            />

            <HeightCase
              index="05.D"
              title={"Unbounded parent · maxHeight=\"40vh\""}
              expectation="Parent is auto-height. maxHeight is a CSS string. Grid caps at 40% of the viewport and scrolls its body. Resize the browser to verify."
              data={DEMO_USERS_200}
              maxHeight="40vh"
            />

            <HeightCase
              index="05.E"
              title="Bounded parent · h-[360px] · no maxHeight"
              expectation="Parent is a bounded box (360px). No maxHeight prop. Grid fills the parent via `h-full` and scrolls its body."
              data={DEMO_USERS_200}
              parentClassName="h-[360px]"
            />

            <HeightCase
              index="05.F"
              title="Bounded flex-col parent · grid is flex-1 sibling"
              expectation="Parent is a `flex flex-col h-[360px]`. A shrink-0 sibling sits above. The grid fills the remaining space via `flex-1 min-h-0` and scrolls its body. This is the canonical layout for dashboard panels."
              data={DEMO_USERS_200}
              parentClassName="h-[360px]"
              wrapInFlex
            />

            <HeightCase
              index="05.G"
              title="Chrome off · toolbar=false · footer=false · maxHeight={320}"
              expectation="Toolbar and footer both hidden. maxHeight is 320. Header + scroll body only. Scroll body should still get exactly the right remaining space with no gap and no clipping."
              data={DEMO_USERS_200}
              maxHeight={320}
              toolbar={false}
              footer={false}
            />

            <HeightCase
              index="05.H"
              title="maxHeight={600} · only 3 rows"
              expectation="maxHeight is larger than the content. Grid should render at its content height (NOT stretch to 600px of empty space). No scrollbar."
              data={DEMO_USERS_200.slice(0, 3)}
              maxHeight={600}
            />
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
