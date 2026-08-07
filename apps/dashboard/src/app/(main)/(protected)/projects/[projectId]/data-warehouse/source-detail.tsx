"use client";

import {
  ActionDialog, Alert, Button, Card, Spinner, Switch, Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, Typography,
} from "@/components/ui";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
import {
  createStreamView, deleteSource, dropStreamView, fetchSourceDetail, fetchSyncRuns, resolveDrift,
  syncNow, updateSource, updateStreams,
  type AdminAppWithInternals, type SourceDetailDto, type SourceStreamDto, type SyncRunDto,
} from "./api";
import {
  ConnectorMark, RunStatusBadge, SourceStatusBadge, formatDuration, formatRowCount, formatSchedule,
  formatTimestamp,
} from "./shared";

/** Refresh cadence while a sync is in flight, so rows appear without a reload. */
const ACTIVE_REFRESH_MS = 3000;

export function SourceDetail(props: {
  adminApp: AdminAppWithInternals,
  sourceId: string,
  onClose: () => void,
  onDeleted: () => void,
}) {
  const [source, setSource] = useState<SourceDetailDto | null>(null);
  const [runs, setRuns] = useState<SyncRunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, runList] = await Promise.all([
        fetchSourceDetail(props.adminApp, props.sourceId),
        fetchSyncRuns(props.adminApp, props.sourceId),
      ]);
      setSource(detail);
      setRuns(runList);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [props.adminApp, props.sourceId]);

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  // Poll only while something is actually moving; a healthy idle source does not
  // need to be re-fetched every three seconds.
  const isActive = source?.status === "SYNCING" || runs.some(run => run.status === "RUNNING");
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => runAsynchronously(load()), ACTIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isActive, load]);

  if (error != null && source == null) {
    return (
      <Alert variant="destructive">
        <Typography className="text-sm">{error}</Typography>
      </Alert>
    );
  }

  if (source == null) {
    return <div className="flex justify-center p-8"><Spinner /></div>;
  }

  const withRefresh = (action: () => Promise<unknown>) => () => {
    setBusy(true);
    runAsynchronouslyWithAlert(async () => {
      try {
        await action();
        await load();
      } finally {
        setBusy(false);
      }
    });
  };

  const driftStreams = source.streams.filter(stream => stream.pending_drift != null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ConnectorMark name={source.connector_display_name} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Typography type="h3" className="truncate text-lg font-semibold">{source.display_name}</Typography>
              <SourceStatusBadge status={source.status} />
            </div>
            <Typography variant="secondary" className="text-xs">
              {source.connector_display_name} · {formatSchedule(source.schedule_kind, source.schedule_value)}
              {source.next_sync_at != null && ` · next ${formatTimestamp(source.next_sync_at)}`}
            </Typography>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={props.onClose}>Back</Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={withRefresh(() => updateSource(props.adminApp, source.id, {
              paused: source.status !== "PAUSED",
            }))}
          >
            {source.status === "PAUSED" ? "Resume" : "Pause"}
          </Button>
          <Button disabled={busy} onClick={withRefresh(() => syncNow(props.adminApp, source.id))}>
            Sync now
          </Button>
          <ActionDialog
            trigger={<Button variant="secondary">Disconnect</Button>}
            title="Disconnect this source?"
            danger
            okButton={{
              label: "Disconnect",
              onClick: async () => {
                await deleteSource(props.adminApp, source.id);
                props.onDeleted();
              },
            }}
            cancelButton
          >
            <Typography className="text-sm">
              The imported data and saved credentials for <strong>{source.display_name}</strong>{" "}
              will be deleted. Any SQL views you created for it are removed too.
            </Typography>
          </ActionDialog>
        </div>
      </div>

      {source.last_error != null && (
        <Alert variant="destructive">
          <Typography className="text-sm font-medium">Last sync failed</Typography>
          <Typography className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {source.last_error}
          </Typography>
        </Alert>
      )}

      {driftStreams.length > 0 && (
        <SchemaDriftPanel
          adminApp={props.adminApp}
          sourceId={source.id}
          streams={driftStreams}
          onResolved={() => runAsynchronously(load())}
        />
      )}

      <Tabs defaultValue="status">
        <TabsList>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="pt-4">
          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stream</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Sync mode</TableHead>
                  <TableHead>Primary key</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {source.streams.map(stream => (
                  <TableRow key={stream.id}>
                    <TableCell className="font-medium">{stream.name}</TableCell>
                    <TableCell>
                      <Switch
                        checked={stream.enabled}
                        disabled={busy}
                        aria-label={`Enable ${stream.name}`}
                        onCheckedChange={checked => withRefresh(() => updateStreams(
                          props.adminApp, source.id, [{ name: stream.name, enabled: checked }],
                        ))()}
                      />
                    </TableCell>
                    <TableCell>{stream.sync_mode === "incremental" ? "Incremental" : "Full refresh"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {stream.primary_key.length > 0 ? stream.primary_key.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatRowCount(stream.row_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Typography variant="secondary" className="mt-2 text-xs">
            Last synced {formatTimestamp(source.last_synced_at)}. To query this data:{" "}
            <code className="font-mono">SELECT * FROM imported_rows WHERE source_id = &apos;{source.id}&apos;</code>
          </Typography>
        </TabsContent>

        <TabsContent value="schema" className="pt-4">
          <SchemaTab
            adminApp={props.adminApp}
            sourceId={source.id}
            streams={source.streams}
            onChanged={() => runAsynchronously(load())}
          />
        </TabsContent>

        <TabsContent value="logs" className="pt-4">
          <SyncHistory runs={runs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** One row per run: status, duration, rows synced, expandable error. */
function SyncHistory(props: { runs: SyncRunDto[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (props.runs.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Typography variant="secondary">
          No syncs yet. Run one with Sync now, or wait for the schedule.
        </Typography>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Rows synced</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.runs.map(run => (
            <>
              <TableRow
                key={run.id}
                className={run.error != null ? "cursor-pointer" : undefined}
                onClick={() => run.error != null && setExpanded(expanded === run.id ? null : run.id)}
              >
                <TableCell><RunStatusBadge status={run.status} /></TableCell>
                <TableCell className="capitalize">{run.trigger}</TableCell>
                <TableCell>{formatTimestamp(run.started_at)}</TableCell>
                <TableCell>{formatDuration(run.duration_ms)}</TableCell>
                <TableCell className="text-right">{formatRowCount(run.rows_synced)}</TableCell>
              </TableRow>
              {expanded === run.id && run.error != null && (
                <TableRow key={`${run.id}-error`}>
                  <TableCell colSpan={5}>
                    <Typography className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                      {run.error}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function SchemaTab(props: {
  adminApp: AdminAppWithInternals,
  sourceId: string,
  streams: SourceStreamDto[],
  onChanged: () => void,
}) {
  const [viewNames, setViewNames] = useState<Record<string, string | undefined>>({});
  return (
    <div className="flex flex-col gap-3">
      <Typography variant="secondary" className="text-xs">
        The fields found when this source was connected.
      </Typography>
      {props.streams.map(stream => (
        <Card key={stream.id} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Typography className="font-medium">{stream.name}</Typography>
            <div className="flex items-center gap-2">
              {viewNames[stream.name] != null && (
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{viewNames[stream.name]}</code>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  const created = await createStreamView(props.adminApp, props.sourceId, stream.name);
                  setViewNames(current => ({ ...current, [stream.name]: created.view_name }));
                })}
              >
                Create SQL view
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await dropStreamView(props.adminApp, props.sourceId, stream.name);
                  setViewNames(current => {
                    const next = { ...current };
                    delete next[stream.name];
                    return next;
                  });
                })}
              >
                Remove view
              </Button>
            </div>
          </div>
          {stream.discovered_schema == null || stream.discovered_schema.fields.length === 0 ? (
            <Typography variant="secondary" className="text-xs">
              No fields were found for this stream.
            </Typography>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stream.discovered_schema.fields.map(field => (
                <span
                  key={field.name}
                  className="rounded border border-border px-2 py-0.5 font-mono text-xs"
                  title={`${field.type} · present on ${Math.round(field.presence * 100)}% of sampled records`}
                >
                  {field.name}
                  <span className="ml-1 text-muted-foreground">{field.type}</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/** Schema drift: what changed, with approve or ignore. */
function SchemaDriftPanel(props: {
  adminApp: AdminAppWithInternals,
  sourceId: string,
  streams: SourceStreamDto[],
  onResolved: () => void,
}) {
  return (
    <Alert>
      <Typography className="text-sm font-medium">
        Schema changed in {props.streams.length} {props.streams.length === 1 ? "stream" : "streams"}
      </Typography>
      <div className="mt-2 flex flex-col gap-3">
        {props.streams.map(stream => {
          const drift = stream.pending_drift;
          if (drift == null) return null;
          return (
            <div key={stream.id} className="flex flex-col gap-1.5">
              <Typography className="text-sm font-medium">{stream.name}</Typography>
              <div className="flex flex-col gap-0.5 font-mono text-xs">
                {drift.addedFields.map(field => (
                  <span key={`add-${field.name}`} className="text-green-600 dark:text-green-400">
                    + {field.name} ({field.type})
                  </span>
                ))}
                {drift.removedFields.map(name => (
                  <span key={`rm-${name}`} className="text-destructive">− {name}</span>
                ))}
                {drift.changedFields.map(field => (
                  <span key={`ch-${field.name}`} className="text-amber-600 dark:text-amber-400">
                    ~ {field.name}: {field.from} → {field.to}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => runAsynchronouslyWithAlert(async () => {
                    await resolveDrift(props.adminApp, props.sourceId, stream.name, "approve");
                    props.onResolved();
                  })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => runAsynchronouslyWithAlert(async () => {
                    await resolveDrift(props.adminApp, props.sourceId, stream.name, "ignore");
                    props.onResolved();
                  })}
                >
                  Ignore
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Alert>
  );
}
