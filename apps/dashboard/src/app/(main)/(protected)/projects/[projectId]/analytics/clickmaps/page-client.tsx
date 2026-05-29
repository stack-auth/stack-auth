"use client";

import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  Alert,
  Button,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
  Typography,
} from "@/components/ui";
import { DesignAnalyticsCard } from "@/components/design-components/analytics-card";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
} from "@stackframe/dashboard-ui-components";
import type { AnalyticsClickmapDevice, AnalyticsClickmapResponse, AnalyticsClickmapTokenResponse } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import {
  CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY,
  CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT,
} from "@stackframe/stack-shared/dist/utils/analytics-clickmap-overlay";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

type ClickmapOrigin = {
  id: string,
  origin: string,
};

type RangeKey = "24h" | "7d" | "30d";
type DeviceFilterKey = "all" | AnalyticsClickmapDevice;

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const RANGE_OPTIONS: Array<{ value: RangeKey, label: string }> = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const DEVICE_OPTIONS: Array<{ value: DeviceFilterKey, label: string }> = [
  { value: "all", label: "All viewports" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
  { value: "laptop", label: "Laptop" },
  { value: "desktop", label: "Desktop" },
  { value: "widescreen", label: "Widescreen" },
  { value: "tv", label: "TV" },
];

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

type TopElementRow = AnalyticsClickmapResponse["elements"][number];

const getTopElementRowId = (row: TopElementRow): string => row.elements_chain;

// Stable column definitions — defined at module scope so the grid instance
// is preserved across renders (required by DataGrid).
const TOP_ELEMENT_COLUMNS: DataGridColumnDef<TopElementRow>[] = [
  {
    id: "clicks",
    header: "Clicks",
    accessor: "clicks",
    type: "number",
    width: 96,
    align: "right",
    sortable: true,
    renderCell: ({ row }) => (
      <span className="inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground">
        {row.clicks}
      </span>
    ),
  },
  {
    id: "element",
    header: "Element",
    accessor: "elements_chain",
    flex: 1,
    minWidth: 240,
    sortable: false,
    cellOverflow: "wrap",
    renderCell: ({ row }) => {
      const text = row.elements_text.trim();
      const fallbackLabel = text !== "" ? text : (row.href ?? "");
      return (
        <div className="min-w-0 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-foreground">{row.tag_name}</span>
            {fallbackLabel !== "" && (
              <span className="truncate text-xs text-muted-foreground">{fallbackLabel}</span>
            )}
          </div>
          <div
            className="truncate font-mono text-[11px] text-muted-foreground/80"
            title={row.elements_chain}
          >
            {truncateMiddle(row.elements_chain, 140)}
          </div>
        </div>
      );
    },
  },
];

function TopElementsPreview(props: {
  adminApp: ReturnType<typeof useAdminApp>,
}) {
  const { adminApp } = props;
  const [range, setRange] = useState<RangeKey>("7d");
  const [device, setDevice] = useState<DeviceFilterKey>("all");
  const [urlPattern, setUrlPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsClickmapResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const until = new Date();
      const since = new Date(until.getTime() - RANGE_MS[range]);
      const options: Parameters<typeof adminApp.getAnalyticsClickmap>[0] = {
        kind: "session_replay_clicks",
        since: since.toISOString(),
        until: until.toISOString(),
        sampling: 1,
      };
      const trimmedPattern = urlPattern.trim();
      if (trimmedPattern !== "") {
        options.urlPattern = trimmedPattern;
      }
      if (device !== "all") {
        options.device = device;
      }
      setLoading(true);
      setError(null);
      adminApp.getAnalyticsClickmap(options)
        .then((response) => {
          if (cancelled) return;
          setData(response);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Avoid surfacing raw error messages to users; show a safe generic message.
          setError("Failed to load top elements.");
          setData(null);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [adminApp, range, device, urlPattern]);

  const elements = useMemo(() => {
    if (data == null) return [];
    // Dedupe by elements_chain so row ids stay unique for virtualization,
    // then sort by clicks descending as the default order.
    const byChain = new Map<string, TopElementRow>();
    for (const element of data.elements) {
      const existing = byChain.get(element.elements_chain);
      if (existing == null || element.clicks > existing.clicks) {
        byChain.set(element.elements_chain, element);
      }
    }
    return Array.from(byChain.values()).sort((a, b) => b.clicks - a.clicks);
  }, [data]);

  const [gridState, setGridState] = useState(() => createDefaultDataGridState(TOP_ELEMENT_COLUMNS));
  const gridData = useDataSource({
    data: elements,
    columns: TOP_ELEMENT_COLUMNS,
    getRowId: getTopElementRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    // Single full page — the grid virtualizes the rows and scrolls them
    // internally, so the whole (deduped) set stays available without paging.
    pagination: { pageIndex: 0, pageSize: Math.max(elements.length, 1) },
    paginationMode: "client",
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Typography className="font-medium">Top elements</Typography>
          <Typography type="p" variant="secondary" className="text-xs">
            Most-clicked elements across replays for the selected filters.
          </Typography>
        </div>
        {loading && (
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>Loading top elements…</span>
          </div>
        )}
      </div>
      {error != null && (
        <Alert variant="destructive" className="mb-2">{error}</Alert>
      )}
      <DataGrid
        columns={TOP_ELEMENT_COLUMNS}
        rows={gridData.rows}
        getRowId={getTopElementRowId}
        totalRowCount={gridData.totalRowCount}
        isLoading={loading && data == null}
        state={gridState}
        onChange={setGridState}
        toolbar={() => (
          <div className="flex w-full min-w-0 flex-col gap-2 border-b border-foreground/[0.06] px-2.5 py-2.5 sm:flex-row sm:items-center">
            <Select value={range} onValueChange={(value) => setRange(value as RangeKey)}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={device} onValueChange={(value) => setDevice(value as DeviceFilterKey)}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEVICE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={urlPattern}
              onChange={(event) => setUrlPattern(event.target.value)}
              placeholder="/products/*"
              className="h-8 w-full text-xs sm:ml-auto sm:w-[220px]"
            />
          </div>
        )}
        footer={false}
        fillHeight={false}
        rowHeight="auto"
        estimatedRowHeight={56}
        overscan={8}
        paginationMode="infinite"
        emptyState={
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No clicks captured in this window.
          </div>
        }
      />
    </div>
  );
}

function normalizeOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

// The clickmap token is a self-describing JWT (its payload carries the project
// and origin it was minted for), so the snippet only has to hand over the token
// itself — the in-page overlay derives everything else from it.
function createConsoleSnippet(token: string): string {
  return [
    `sessionStorage.setItem(${JSON.stringify(CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY)}, ${JSON.stringify(token)});`,
    `window.dispatchEvent(new Event(${JSON.stringify(CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT)}));`,
  ].join("\n");
}

function installClickmapTokenForCurrentOrigin(token: AnalyticsClickmapTokenResponse): boolean {
  if (token.origin !== window.location.origin) {
    return false;
  }
  try {
    window.sessionStorage.setItem(CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY, token.token);
    window.dispatchEvent(new Event(CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT));
    return true;
  } catch {
    window.alert("Could not enable the clickmap toolbar in this tab. Copy the snippet and paste it in the console instead.");
    return false;
  }
}

function ClickmapTokenDialog(props: {
  origin: ClickmapOrigin | null,
  token: AnalyticsClickmapTokenResponse | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const snippet = props.token == null ? "" : createConsoleSnippet(props.token.token);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enable clickmap toolbar</DialogTitle>
          <DialogDescription>
            Paste this in the console on {props.origin?.origin ?? "the selected site"}. The token expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {props.token == null ? (
            <Alert>Creating clickmap token...</Alert>
          ) : (
            <>
              <CopyField type="textarea" value={snippet} monospace fixedSize height={124} />
              <Typography type="p" variant="secondary" className="text-sm">
                The site will use normal client authentication plus this origin-bound clickmap token to fetch aggregate clickmap data.
              </Typography>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={props.token == null}
            onClick={() => {
              const target = props.token?.origin ?? props.origin?.origin;
              if (target != null) {
                window.open(target, "_blank", "noopener,noreferrer");
              }
              props.onOpenChange(false);
            }}
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState<ClickmapOrigin | null>(null);
  const [token, setToken] = useState<AnalyticsClickmapTokenResponse | null>(null);
  const [customOrigin, setCustomOrigin] = useState("http://localhost:8101");

  const origins = useMemo(() => {
    const byOrigin = new Map<string, ClickmapOrigin>();
    for (const [id, domain] of typedEntries(config.domains.trustedDomains)) {
      if (domain.baseUrl == null) {
        continue;
      }
      const origin = normalizeOrigin(domain.baseUrl);
      if (origin == null) {
        continue;
      }
      byOrigin.set(origin, { id, origin });
    }
    return Array.from(byOrigin.values()).sort((a, b) => stringCompare(a.origin, b.origin));
  }, [config.domains.trustedDomains]);

  async function showClickmap(origin: ClickmapOrigin) {
    setSelectedOrigin(origin);
    setToken(null);
    setDialogOpen(true);
    let created: AnalyticsClickmapTokenResponse;
    try {
      created = await adminApp.createAnalyticsClickmapToken({ origin: origin.origin });
    } catch (error) {
      // Token creation failed (network error, expired session, invalid origin,
      // etc.); close the dialog so it doesn't hang on "Creating..." and let
      // runAsynchronouslyWithAlert surface the error to the user.
      setToken(null);
      setDialogOpen(false);
      throw error;
    }
    setToken(created);
    const installedInCurrentTab = installClickmapTokenForCurrentOrigin(created);
    try {
      await navigator.clipboard.writeText(createConsoleSnippet(created.token));
      toast({ title: installedInCurrentTab ? "Clickmap toolbar enabled" : "Snippet copied to clipboard" });
    } catch {
      // Clipboard access can be denied (e.g. lost user-gesture after the
      // network round-trip); the snippet stays available to copy manually.
    }
  }

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Clickmaps"
        description="Launch the clickmap toolbar on a trusted domain."
        fillWidth
      >
        {config.domains.allowLocalhost && (
          <DesignAnalyticsCard gradient="slate" className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Typography className="font-medium">Localhost origin</Typography>
                <Typography type="p" variant="secondary" className="text-xs">
                  Use the exact origin shown in the browser address bar for your local site.
                </Typography>
                <Input value={customOrigin} onChange={(event) => setCustomOrigin(event.target.value)} placeholder="http://localhost:3000" />
              </div>
              <Button onClick={async () => await showClickmap({ id: "localhost", origin: customOrigin })}>
                Show clickmap
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </DesignAnalyticsCard>
        )}

        {origins.length === 0 ? (
          <Alert className="rounded-2xl">
            Add a trusted domain before launching a production clickmap.
          </Alert>
        ) : (
          <DesignAnalyticsCard gradient="slate">
            {origins.map((origin) => (
              <div key={origin.id} className="flex flex-col gap-3 border-b border-foreground/[0.05] p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
                    <GlobeHemisphereWest className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <Typography className="truncate font-medium">{origin.origin}</Typography>
                    <Typography type="p" variant="secondary" className="text-xs">
                      24-hour overlay token, scoped to this origin
                    </Typography>
                  </div>
                </div>
                <Button onClick={async () => await showClickmap(origin)}>
                  Show clickmap
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </DesignAnalyticsCard>
        )}

        <TopElementsPreview adminApp={adminApp} />
        <ClickmapTokenDialog
          origin={selectedOrigin}
          token={token}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
