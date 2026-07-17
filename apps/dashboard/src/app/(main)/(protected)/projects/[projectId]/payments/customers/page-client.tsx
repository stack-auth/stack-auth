"use client";

import { CreateCheckoutDialog } from "@/components/payments/create-checkout-dialog";
import { CustomerPaymentsSection, type CustomerType } from "@/components/payments/customer-payments-section";
import { DesignBadge, type DesignBadgeColor } from "@/components/design-components";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Typography,
} from "@/components/ui";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@hexclave/dashboard-ui-components";
import { ArrowLeftIcon, MagnifyingGlassIcon, ShoppingCartIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

const PAGE_SIZE = 25;
// Custom customers aren't enumerable directly — we derive distinct ids from
// recent transactions, scanning this many per page.
const CUSTOM_TX_PAGE_SIZE = 100;
// Bound the transaction scan so a no-match search (or a project with a very
// long history) can't walk the entire transaction log page-by-page. Custom
// customers are derived from the most recent CUSTOM_TX_PAGE_SIZE *
// MAX_CUSTOM_SCAN_PAGES transactions.
const MAX_CUSTOM_SCAN_PAGES = 20;
const SEARCH_DEBOUNCE_MS = 300;

type CustomerFilter = "all" | CustomerType;

type CustomerRow = {
  type: CustomerType,
  id: string,
  label: string,
  profileImageUrl?: string | null,
};

const TYPE_BADGE: Record<CustomerType, { label: string, color: DesignBadgeColor }> = {
  user: { label: "User", color: "blue" },
  team: { label: "Team", color: "purple" },
  custom: { label: "Custom", color: "orange" },
};

// Phases walked by the merged ("all") data source. Each fetch produces one
// page and points the cursor at the next phase once a source is exhausted.
type Phase = "user" | "team" | "custom";

type CursorState = { phase: Phase, inner?: string, scanned?: number };

export default function PageClient() {
  const [selected, setSelected] = useState<CustomerRow | null>(null);

  if (selected) {
    return <CustomerDetailView customer={selected} onBack={() => setSelected(null)} />;
  }
  return <CustomerListView onOpen={setSelected} />;
}

// ─── List view ───────────────────────────────────────────────────────

function CustomerListView({ onOpen }: { onOpen: (customer: CustomerRow) => void }) {
  const adminApp = useAdminApp();
  const [filter, setFilter] = useState<CustomerFilter>("all");

  const columns = useMemo<DataGridColumnDef<CustomerRow>[]>(() => [
    {
      id: "type",
      header: "Type",
      width: 110,
      sortable: false,
      renderCell: ({ row }) => {
        const badge = TYPE_BADGE[row.type];
        return <DesignBadge label={badge.label} color={badge.color} size="sm" />;
      },
    },
    {
      id: "customer",
      header: "Customer",
      width: 220,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <div className="flex items-center gap-3 min-w-0">
          {row.type === "user" ? (
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarImage src={row.profileImageUrl ?? undefined} />
              <AvatarFallback className="text-xs">{row.label.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          ) : null}
          <span className="truncate text-sm font-medium text-foreground" title={row.label}>{row.label}</span>
        </div>
      ),
    },
    {
      id: "id",
      header: "ID",
      width: 220,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="truncate font-mono text-xs text-muted-foreground" title={row.id}>{row.id}</span>
      ),
    },
  ], []);

  const [gridState, setGridState] = useDataGridUrlState(columns, { paramPrefix: "customers" });
  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);

  // Dedup set for custom customers derived from transactions; reset on each
  // fresh pagination (cursor-less first page).
  const seenCustomIdsRef = useRef<Set<string>>(new Set());

  const dataSource = useMemo<DataGridDataSource<CustomerRow>>(
    () => async function* (params) {
      const query = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const cursorRaw = typeof params.cursor === "string" ? params.cursor : undefined;
      if (!cursorRaw) {
        seenCustomIdsRef.current = new Set();
      }

      const firstPhase: Phase = filter === "all" ? "user" : filter;
      // The cursor is opaque pagination state we encode ourselves, but guard the
      // parse anyway so a corrupted value just restarts from the first page
      // instead of throwing inside the async generator.
      let state: CursorState;
      try {
        state = cursorRaw ? JSON.parse(cursorRaw) as CursorState : { phase: firstPhase };
      } catch {
        state = { phase: firstPhase };
      }

      const nextPhase = (phase: Phase): Phase | null => {
        if (filter !== "all") return null;
        if (phase === "user") return "team";
        if (phase === "team") return "custom";
        return null;
      };

      const advance = (rows: CustomerRow[], phase: Phase, innerNext?: string) => {
        if (innerNext) {
          return { rows, hasMore: true, nextCursor: JSON.stringify({ phase, inner: innerNext } satisfies CursorState) };
        }
        const np = nextPhase(phase);
        if (np) {
          return { rows, hasMore: true, nextCursor: JSON.stringify({ phase: np } satisfies CursorState) };
        }
        return { rows, hasMore: false, nextCursor: undefined };
      };

      if (state.phase === "user") {
        const result = await adminApp.listUsers({ limit: PAGE_SIZE, query, cursor: state.inner });
        const rows: CustomerRow[] = result.map((u) => ({
          type: "user",
          id: u.id,
          label: u.displayName ?? u.primaryEmail ?? u.id,
          profileImageUrl: u.profileImageUrl,
        }));
        yield advance(rows, "user", result.nextCursor ?? undefined);
        return;
      }

      if (state.phase === "team") {
        const result = await adminApp.listTeams({ limit: PAGE_SIZE, orderBy: "createdAt", desc: true, query, cursor: state.inner });
        const rows: CustomerRow[] = result.map((t) => ({ type: "team", id: t.id, label: t.displayName }));
        yield advance(rows, "team", result.nextCursor ?? undefined);
        return;
      }

      // custom: derive distinct customer ids from the most recent transactions.
      // Bounded by MAX_CUSTOM_SCAN_PAGES so we never page through the entire
      // transaction history (e.g. for a search that matches nothing).
      const scanned = (state.scanned ?? 0) + 1;
      const result = await adminApp.listTransactions({ limit: CUSTOM_TX_PAGE_SIZE, customerType: "custom", cursor: state.inner });
      const rows: CustomerRow[] = [];
      for (const transaction of result.transactions) {
        if (transaction.customer_type !== "custom" || !transaction.customer_id) continue;
        const id = transaction.customer_id;
        if (seenCustomIdsRef.current.has(id)) continue;
        seenCustomIdsRef.current.add(id);
        if (query && !id.toLowerCase().includes(query.toLowerCase())) continue;
        rows.push({ type: "custom", id, label: id });
      }
      const innerNext = scanned < MAX_CUSTOM_SCAN_PAGES ? (result.nextCursor ?? undefined) : undefined;
      if (innerNext) {
        yield { rows, hasMore: true, nextCursor: JSON.stringify({ phase: "custom", inner: innerNext, scanned } satisfies CursorState) };
      } else {
        yield { rows, hasMore: false, nextCursor: undefined };
      }
    },
    [adminApp, filter],
  );

  const getRowId = useCallback((row: CustomerRow) => `${row.type}:${row.id}`, []);

  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: debouncedQuickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <PageLayout
      title="Customers"
      description="Browse every user, team, and custom customer in one place."
    >
      <DataGrid
        columns={columns}
        rows={gridData.rows}
        getRowId={getRowId}
        isLoading={gridData.isLoading}
        isRefetching={gridData.isRefetching}
        state={gridState}
        onChange={setGridState}
        paginationMode="infinite"
        hasMore={gridData.hasMore}
        isLoadingMore={gridData.isLoadingMore}
        onLoadMore={gridData.loadMore}
        rowHeight="auto"
        estimatedRowHeight={44}
        footer={false}
        fillHeight={false}
        onRowClick={(row) => onOpen(row)}
        toolbarExtra={
          <Select value={filter} onValueChange={(value) => setFilter(value as CustomerFilter)}>
            <SelectTrigger className="w-[160px] h-8 text-xs" aria-label="Customer type filter">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All customers</SelectItem>
              <SelectItem value="user">Users</SelectItem>
              <SelectItem value="team">Teams</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        }
        emptyState={
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <MagnifyingGlassIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-base font-medium text-foreground">No customers found</div>
            <p className="text-sm text-muted-foreground">
              {filter === "custom"
                ? "Custom customers appear here once they have transactions."
                : "Try adjusting your search or filter."}
            </p>
          </div>
        }
      />
    </PageLayout>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────

function CustomerDetailView({ customer, onBack }: { customer: CustomerRow, onBack: () => void }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const badge = TYPE_BADGE[customer.type];

  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2 text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Back to customers
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <Typography type="h2" className="truncate">{customer.label}</Typography>
            <div className="flex items-center gap-2 flex-wrap">
              <DesignBadge label={badge.label} color={badge.color} size="sm" />
              <span className="font-mono text-xs text-muted-foreground">{customer.id}</span>
            </div>
          </div>
          <Button onClick={() => setCheckoutOpen(true)}>
            <ShoppingCartIcon className="h-4 w-4 mr-1.5" />
            Create checkout
          </Button>
        </div>

        <CustomerPaymentsSection customerType={customer.type} customerId={customer.id} />
      </div>

      <CreateCheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} customer={customer} />
    </PageLayout>
  );
}
