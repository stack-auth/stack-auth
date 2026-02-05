"use client";

import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@/components/ui";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";

const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");
const AUTO_REFRESH_INTERVAL_MS = 5000;

type SequenceStats = {
  total: string,
  pending: string,
  null_sequence_id: string,
  min_sequence_id: string | null,
  max_sequence_id: string | null,
};

type DeletedRowStats = SequenceStats & {
  by_table: Array<SequenceStats & { table_name: string }>,
};

type PollerStats = {
  total: string,
  pending: string,
  in_flight: string,
  stale: string,
  oldest_created_at_millis: number | null,
  newest_created_at_millis: number | null,
};

type MappingStats = {
  mapping_id: string,
  internal_min_sequence_id: string | null,
  internal_max_sequence_id: string | null,
  internal_pending_count: string,
};

type ExternalDbMetadata = {
  mapping_name: string,
  last_synced_sequence_id: string,
  updated_at_millis: number | null,
};

type ExternalDbMappingStatus = {
  mapping_id: string,
  internal_max_sequence_id: string | null,
  last_synced_sequence_id: string | null,
  updated_at_millis: number | null,
  backlog: string | null,
};

type ExternalDbSyncStatus = {
  ok: true,
  generated_at_millis: number,
  global: {
    tenancies_total: string,
    tenancies_with_db_sync: string,
    sequencer: {
      project_users: SequenceStats,
      contact_channels: SequenceStats,
      deleted_rows: DeletedRowStats,
    },
    poller: PollerStats,
    sync_engine: {
      mappings: MappingStats[],
    },
  } | null,
  tenancy: {
    id: string,
    project_id: string,
    branch_id: string,
  },
  sequencer: {
    project_users: SequenceStats,
    contact_channels: SequenceStats,
    deleted_rows: DeletedRowStats,
  },
  poller: PollerStats,
  sync_engine: {
    mappings: MappingStats[],
    external_databases: Array<{
      id: string,
      type: string,
      connection: {
        redacted: string | null,
        host: string | null,
        port: number | null,
        database: string | null,
        user: string | null,
      },
      status: "ok" | "error",
      error: string | null,
      metadata: ExternalDbMetadata[],
      users_table: {
        exists: boolean,
        total_rows: string | null,
        min_signed_up_at_millis: number | null,
        max_signed_up_at_millis: number | null,
      },
      mapping_status: ExternalDbMappingStatus[],
    }>,
  },
};

type ExternalDbSyncFusebox = {
  sequencerEnabled: boolean,
  pollerEnabled: boolean,
};

type ExternalDbSyncFuseboxResponse = {
  ok: true,
  sequencer_enabled: boolean,
  poller_enabled: boolean,
};

type AdminAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

type AdminAppWithInternals = ReturnType<typeof useAdminApp> & {
  [stackAppInternalsSymbol]: AdminAppInternals,
};

function formatBigInt(value: string | null) {
  if (value === null) return "—";
  if (value.length > 15) return value;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? new Intl.NumberFormat().format(asNumber) : value;
}

function formatMillis(value: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function sumBigIntStrings(values: Array<string | null | undefined>) {
  let total = BigInt(0);
  for (const value of values) {
    if (!value) continue;
    if (!/^[-]?\d+$/.test(value)) continue;
    total += BigInt(value);
  }
  return total.toString();
}

function parseBigIntString(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!/^[-]?\d+$/.test(value)) return null;
  return BigInt(value);
}

const BIGINT_ZERO = BigInt(0);
const BIGINT_HUNDRED = BigInt(100);
const BIGINT_THOUSAND = BigInt(1000);

function formatThroughput(value: bigint | number | null) {
  if (value === null) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0/s";
    const sign = value > 0 ? "+" : "";
    const abs = Math.abs(value);
    const display = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
    return `${sign}${display}/s`;
  }
  if (value === BIGINT_ZERO) return "0/s";
  const sign = value > BIGINT_ZERO ? "+" : "";
  const abs = value > BIGINT_ZERO ? value : -value;
  const intPart = abs / BIGINT_HUNDRED;
  const fracPart = abs % BIGINT_HUNDRED;
  const intDisplay = new Intl.NumberFormat().format(intPart);
  const fracDisplay = fracPart.toString().padStart(2, "0");
  const display = intPart === BIGINT_ZERO ? `0.${fracDisplay}` : `${intDisplay}.${fracDisplay}`;
  return `${sign}${display}/s`;
}

function calculateThroughputScaled(prev: bigint | null, current: bigint | null, deltaMillis: number) {
  if (prev === null || current === null) return null;
  if (deltaMillis <= 0) return null;
  const deltaMillisBigInt = BigInt(deltaMillis);
  return (prev - current) * BIGINT_THOUSAND * BIGINT_HUNDRED / deltaMillisBigInt;
}

function DataValue(props: { value: string | null | undefined, loading: boolean }) {
  if (props.loading) {
    return <Skeleton className="h-5 w-20" />;
  }
  return <span>{formatBigInt(props.value ?? null)}</span>;
}

function DataDate(props: { value: number | null | undefined, loading: boolean }) {
  if (props.loading) {
    return <Skeleton className="h-5 w-32" />;
  }
  return <span>{formatMillis(props.value ?? null)}</span>;
}

export default function PageClient() {
  const adminApp = useAdminApp() as AdminAppWithInternals;
  const [status, setStatus] = useState<ExternalDbSyncStatus | null>(null);
  const [fusebox, setFusebox] = useState<ExternalDbSyncFusebox | null>(null);
  const [savedFusebox, setSavedFusebox] = useState<ExternalDbSyncFusebox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [savingFusebox, setSavingFusebox] = useState(false);
  const inFlightRef = useRef(false);
  const summarySamplesRef = useRef<Array<{
    timestampMillis: number,
    sequencerPending: string,
    pollerPending: string,
    mappingPending: string,
  }>>([]);

  const loadStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);

    const result = await Result.fromPromise((async () => {
      const response = await adminApp[stackAppInternalsSymbol].sendRequest(
        "/internal/external-db-sync/status?scope=all",
        { method: "GET" },
        "admin",
      );
      const body = await response.json();
      if (!response.ok) {
        const message = typeof body?.error === "string" ? body.error : "Failed to load external DB sync status.";
        throw new Error(message);
      }
      return body as ExternalDbSyncStatus;
    })());

    if (result.status === "error") {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      setError(message);
      setLoading(false);
      inFlightRef.current = false;
      return;
    }

    setStatus(result.data);
    setError(null);
    setLoading(false);
    inFlightRef.current = false;
  }, [adminApp]);

  const loadFusebox = useCallback(async () => {
    const result = await Result.fromPromise((async () => {
      const response = await adminApp[stackAppInternalsSymbol].sendRequest(
        urlString`/internal/external-db-sync/fusebox`,
        { method: "GET" },
        "admin",
      );
      const body = await response.json();
      if (!response.ok) {
        const message = typeof body?.error === "string" ? body.error : "Failed to load external DB sync fusebox.";
        throw new Error(message);
      }
      return body as ExternalDbSyncFuseboxResponse;
    })());

    if (result.status === "error") {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      setError(message);
      return;
    }

    const nextFusebox = {
      sequencerEnabled: result.data.sequencer_enabled,
      pollerEnabled: result.data.poller_enabled,
    };
    setFusebox(nextFusebox);
    setSavedFusebox(nextFusebox);
    setError(null);
  }, [adminApp]);

  const saveFusebox = useCallback(async () => {
    if (!fusebox) return;
    setSavingFusebox(true);
    const result = await Result.fromPromise((async () => {
      const response = await adminApp[stackAppInternalsSymbol].sendRequest(
        urlString`/internal/external-db-sync/fusebox`,
        {
          method: "POST",
          body: JSON.stringify({
            sequencer_enabled: fusebox.sequencerEnabled,
            poller_enabled: fusebox.pollerEnabled,
          }),
          headers: { "content-type": "application/json" },
        },
        "admin",
      );
      const body = await response.json();
      if (!response.ok) {
        const message = typeof body?.error === "string" ? body.error : "Failed to update external DB sync fusebox.";
        throw new Error(message);
      }
      return body as ExternalDbSyncFuseboxResponse;
    })());
    setSavingFusebox(false);

    if (result.status === "error") {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      setError(message);
      return;
    }

    const nextFusebox = {
      sequencerEnabled: result.data.sequencer_enabled,
      pollerEnabled: result.data.poller_enabled,
    };
    setFusebox(nextFusebox);
    setSavedFusebox(nextFusebox);
    setError(null);
  }, [adminApp, fusebox]);

  const refreshWithAlert = useCallback(() => {
    runAsynchronouslyWithAlert(loadStatus);
  }, [loadStatus]);

  useEffect(() => {
    runAsynchronously(loadStatus);
  }, [loadStatus]);

  useEffect(() => {
    runAsynchronously(loadFusebox);
  }, [loadFusebox]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => {
      runAsynchronously(loadStatus);
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, loadStatus]);

  const summaryStats = useMemo(() => {
    if (!status) return null;
    const summarySource = status.global ?? status;
    const sequencerPending = sumBigIntStrings([
      summarySource.sequencer.project_users.pending,
      summarySource.sequencer.contact_channels.pending,
      summarySource.sequencer.deleted_rows.pending,
    ]);
    const mappingPending = sumBigIntStrings(
      summarySource.sync_engine.mappings.map((mapping) => mapping.internal_pending_count),
    );

    return {
      sequencerPending,
      pollerPending: summarySource.poller.pending,
      mappingPending,
      isGlobal: Boolean(status.global),
    };
  }, [status]);

  const throughputStats = useMemo(() => {
    if (!status || !summaryStats) return null;
    const currentSample = {
      timestampMillis: status.generated_at_millis,
      sequencerPending: summaryStats.sequencerPending,
      pollerPending: summaryStats.pollerPending,
      mappingPending: summaryStats.mappingPending,
    };
    const samples = summarySamplesRef.current;
    const samplesWithCurrent = samples.length === 0 || samples[samples.length - 1].timestampMillis !== currentSample.timestampMillis
      ? [...samples, currentSample]
      : samples;
    const windowStart = status.generated_at_millis - 20000;
    const windowedSamples = samplesWithCurrent.filter((sample) => sample.timestampMillis >= windowStart);
    if (windowedSamples.length < 2) return null;
    const oldest = windowedSamples[0];
    const deltaMillis = status.generated_at_millis - oldest.timestampMillis;
    if (deltaMillis <= 0) return null;

    return {
      sequencer: calculateThroughputScaled(
        parseBigIntString(oldest.sequencerPending),
        parseBigIntString(summaryStats.sequencerPending),
        deltaMillis,
      ),
      poller: calculateThroughputScaled(
        parseBigIntString(oldest.pollerPending),
        parseBigIntString(summaryStats.pollerPending),
        deltaMillis,
      ),
      mapping: calculateThroughputScaled(
        parseBigIntString(oldest.mappingPending),
        parseBigIntString(summaryStats.mappingPending),
        deltaMillis,
      ),
    };
  }, [status, summaryStats]);

  useEffect(() => {
    if (!status || !summaryStats) return;
    const nextSamples = [...summarySamplesRef.current, {
      timestampMillis: status.generated_at_millis,
      sequencerPending: summaryStats.sequencerPending,
      pollerPending: summaryStats.pollerPending,
      mappingPending: summaryStats.mappingPending,
    }];
    const windowStart = status.generated_at_millis - 20000;
    summarySamplesRef.current = nextSamples.filter((sample) => sample.timestampMillis >= windowStart);
  }, [status, summaryStats]);

  const loadingState = loading && !status;
  const globalStatus = status?.global ?? null;
  const deletedRowsByTable = status?.sequencer.deleted_rows.by_table ?? [];
  const mappingRows = status?.sync_engine.mappings ?? [];
  const fuseboxDirty = useMemo(() => {
    if (!fusebox || !savedFusebox) return false;
    return fusebox.sequencerEnabled !== savedFusebox.sequencerEnabled
      || fusebox.pollerEnabled !== savedFusebox.pollerEnabled;
  }, [fusebox, savedFusebox]);

  if (adminApp.projectId !== "internal") {
    return notFound();
  }

  return (
    <PageLayout
      title="External DB Sync"
      description="Real-time sequencing, queue, and sync visibility across all tenancies."
      actions={
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <span>Auto refresh</span>
          </div>
          <Button onClick={refreshWithAlert} loading={loading} variant="secondary">
            Refresh
          </Button>
        </div>
      }
      fillWidth
    >
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Scope: {globalStatus ? "All tenancies" : "Current tenancy"}</span>
        {globalStatus && (
          <>
            <span>Tenancies: {formatBigInt(globalStatus.tenancies_total)}</span>
            <span>DB sync configs: {formatBigInt(globalStatus.tenancies_with_db_sync)}</span>
          </>
        )}
        <span>Last updated: {status ? formatMillis(status.generated_at_millis) : "—"}</span>
      </div>


      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Sequencer pending rows</CardDescription>
            <CardTitle className="text-2xl">
              {loadingState ? <Skeleton className="h-8 w-28" /> : formatBigInt(summaryStats?.sequencerPending ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div>ProjectUser + ContactChannel + DeletedRow rows waiting for sequence IDs.</div>
            <div className="flex items-center justify-between">
              <span>Throughput</span>
              <span>{loadingState ? "—" : formatThroughput(throughputStats?.sequencer ?? null)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Outgoing sync requests</CardDescription>
            <CardTitle className="text-2xl">
              {loadingState ? <Skeleton className="h-8 w-24" /> : formatBigInt(summaryStats?.pollerPending ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div>Requests still queued for the poller to dispatch.</div>
            <div className="flex items-center justify-between">
              <span>Throughput</span>
              <span>{loadingState ? "—" : formatThroughput(throughputStats?.poller ?? null)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Mapping pending rows</CardDescription>
            <CardTitle className="text-2xl">
              {loadingState ? <Skeleton className="h-8 w-24" /> : formatBigInt(summaryStats?.mappingPending ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div>Pending internal rows waiting for sync across mappings.</div>
            <div className="flex items-center justify-between">
              <span>Throughput</span>
              <span>{loadingState ? "—" : formatThroughput(throughputStats?.mapping ?? null)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sequencer</CardTitle>
            <CardDescription>Rows awaiting sequence ID backfill per table.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Null Seq</TableHead>
                  <TableHead>Min Seq</TableHead>
                  <TableHead>Max Seq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">ProjectUser</TableCell>
                  <TableCell><DataValue value={status?.sequencer.project_users.total} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.project_users.pending} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.project_users.null_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.project_users.min_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.project_users.max_sequence_id} loading={loadingState} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">ContactChannel</TableCell>
                  <TableCell><DataValue value={status?.sequencer.contact_channels.total} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.contact_channels.pending} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.contact_channels.null_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.contact_channels.min_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.contact_channels.max_sequence_id} loading={loadingState} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">DeletedRow</TableCell>
                  <TableCell><DataValue value={status?.sequencer.deleted_rows.total} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.deleted_rows.pending} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.deleted_rows.null_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.deleted_rows.min_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.sequencer.deleted_rows.max_sequence_id} loading={loadingState} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="mt-4">
              <Typography type="p" className="text-xs font-semibold uppercase text-muted-foreground">
                Deleted rows by table
              </Typography>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Pending</TableHead>
                    <TableHead>Null Seq</TableHead>
                    <TableHead>Min Seq</TableHead>
                    <TableHead>Max Seq</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedRowsByTable.map((row) => (
                    <TableRow key={row.table_name}>
                      <TableCell className="font-medium">{row.table_name}</TableCell>
                      <TableCell><DataValue value={row.total} loading={loadingState} /></TableCell>
                      <TableCell><DataValue value={row.pending} loading={loadingState} /></TableCell>
                      <TableCell><DataValue value={row.null_sequence_id} loading={loadingState} /></TableCell>
                      <TableCell><DataValue value={row.min_sequence_id} loading={loadingState} /></TableCell>
                      <TableCell><DataValue value={row.max_sequence_id} loading={loadingState} /></TableCell>
                    </TableRow>
                  ))}
                  {!loadingState && deletedRowsByTable.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No deleted rows recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Poller</CardTitle>
            <CardDescription>OutgoingRequest queue and processing overview.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Total</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>In Flight</TableHead>
                  <TableHead>Stale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell><DataValue value={status?.poller.total} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.poller.pending} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.poller.in_flight} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={status?.poller.stale} loading={loadingState} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Oldest request</span>
                <DataDate value={status?.poller.oldest_created_at_millis} loading={loadingState} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Newest request</span>
                <DataDate value={status?.poller.newest_created_at_millis} loading={loadingState} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sync Engine</CardTitle>
          <CardDescription>Internal mapping checkpoints before external sync.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mapping</TableHead>
                <TableHead>Min Seq</TableHead>
                <TableHead>Max Seq</TableHead>
                <TableHead>Pending Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappingRows.map((mapping) => (
                <TableRow key={mapping.mapping_id}>
                  <TableCell className="font-medium">{mapping.mapping_id}</TableCell>
                  <TableCell><DataValue value={mapping.internal_min_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={mapping.internal_max_sequence_id} loading={loadingState} /></TableCell>
                  <TableCell><DataValue value={mapping.internal_pending_count} loading={loadingState} /></TableCell>
                </TableRow>
              ))}
              {!loadingState && mappingRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No mappings configured.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fusebox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!fusebox ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-9 w-24" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <Typography type="p" className="text-sm font-medium">Sequencer</Typography>
                  <Typography type="p" className="text-xs text-muted-foreground">Assigns sequence IDs and queues sync work.</Typography>
                </div>
                <Switch
                  checked={fusebox.sequencerEnabled}
                  onCheckedChange={(checked) => setFusebox((current) => current ? { ...current, sequencerEnabled: checked } : current)}
                />
              </div>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <Typography type="p" className="text-sm font-medium">Poller</Typography>
                  <Typography type="p" className="text-xs text-muted-foreground">Dispatches queued sync jobs to QStash.</Typography>
                </div>
                <Switch
                  checked={fusebox.pollerEnabled}
                  onCheckedChange={(checked) => setFusebox((current) => current ? { ...current, pollerEnabled: checked } : current)}
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={saveFusebox} disabled={!fuseboxDirty || savingFusebox} loading={savingFusebox}>
                  Save
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </PageLayout>
  );
}
