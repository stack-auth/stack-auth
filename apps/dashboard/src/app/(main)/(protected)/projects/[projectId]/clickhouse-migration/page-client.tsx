"use client";

import { ClickhouseMigrationRequest, ClickhouseMigrationResponse } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Typography, Alert } from "@stackframe/stack-ui";
import React from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { notFound } from "next/navigation";

type MigrationCursor = {
  createdAtMillis: number,
  id: string,
};

type MigrationSnapshot = {
  totalEvents: number,
  processedEvents: number,
  remainingEvents: number,
  migratedEvents: number,
  skippedExistingEvents: number,
  insertedRows: number,
  progress: number,
  nextCursor: MigrationCursor | null,
};

const normalizeResponse = (response: ClickhouseMigrationResponse): MigrationSnapshot => ({
  totalEvents: response.total_events,
  processedEvents: response.processed_events,
  remainingEvents: response.remaining_events,
  migratedEvents: response.migrated_events,
  skippedExistingEvents: response.skipped_existing_events,
  insertedRows: response.inserted_rows,
  progress: response.progress,
  nextCursor: response.next_cursor ? {
    createdAtMillis: response.next_cursor.created_at_millis,
    id: response.next_cursor.id,
  } : null,
});

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const adminInterface = React.useMemo(() => (stackAdminApp as any)._interface as {
    migrateEventsToClickhouse: (options: ClickhouseMigrationRequest) => Promise<ClickhouseMigrationResponse>,
  }, [stackAdminApp]);

  const [minCreatedAt, setMinCreatedAt] = React.useState("");
  const [maxCreatedAt, setMaxCreatedAt] = React.useState("");
  const [limit, setLimit] = React.useState(1000);
  const [stats, setStats] = React.useState<MigrationSnapshot | null>(null);
  const [cursor, setCursor] = React.useState<MigrationCursor | null>(null);
  const [running, setRunning] = React.useState(false);
  const runningRef = React.useRef(false);
  const cursorRef = React.useRef<MigrationCursor | null>(null);
  const timeWindowRef = React.useRef<{ minCreatedAtMillis: number, maxCreatedAtMillis: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const parseCreatedAtMillis = React.useCallback((value: string | undefined) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsed = new Date(trimmed).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, []);

  const buildRequestBody = React.useCallback(() => {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(1000, limit) : 1000;
    const minCreatedAtMillis = timeWindowRef.current?.minCreatedAtMillis ?? parseCreatedAtMillis(minCreatedAt);
    const maxCreatedAtMillis = timeWindowRef.current?.maxCreatedAtMillis ?? parseCreatedAtMillis(maxCreatedAt);
    if (minCreatedAtMillis === null || maxCreatedAtMillis === null) {
      throw new Error("Please provide valid unix millis (Date.now()) or ISO/datetime-local values for min/max created at.");
    }
    return {
      min_created_at_millis: minCreatedAtMillis,
      max_created_at_millis: maxCreatedAtMillis,
      cursor: cursorRef.current ? {
        created_at_millis: cursorRef.current.createdAtMillis,
        id: cursorRef.current.id,
      } : undefined,
      limit: safeLimit,
    };
  }, [limit, maxCreatedAt, minCreatedAt, parseCreatedAtMillis]);

  const runBatch = React.useCallback(async () => {
    const response = await adminInterface.migrateEventsToClickhouse(buildRequestBody());
    const snapshot = normalizeResponse(response);
    setStats(snapshot);
    cursorRef.current = snapshot.nextCursor;
    setCursor(snapshot.nextCursor);
    return snapshot;
  }, [adminInterface, buildRequestBody]);

  const stopMigration = React.useCallback(() => {
    runningRef.current = false;
    setRunning(false);
  }, []);

  const resetMigration = React.useCallback(() => {
    stopMigration();
    cursorRef.current = null;
    timeWindowRef.current = null;
    setCursor(null);
    setStats(null);
    setError(null);
  }, [stopMigration]);

  const startMigration = React.useCallback(async () => {
    if (runningRef.current) return;
    const minCreatedAtMillis = parseCreatedAtMillis(minCreatedAt);
    const maxCreatedAtMillis = parseCreatedAtMillis(maxCreatedAt);
    if (minCreatedAtMillis === null || maxCreatedAtMillis === null) {
      setError("Please provide valid unix millis (Date.now()) or ISO/datetime-local values for min/max created at.");
      return;
    }
    if (minCreatedAtMillis >= maxCreatedAtMillis) {
      setError("Min created at must be before max created at.");
      return;
    }
    setError(null);
    timeWindowRef.current = { minCreatedAtMillis, maxCreatedAtMillis };
    runningRef.current = true;
    setRunning(true);

    try {
      while (runningRef.current) {
        const snapshot = await runBatch();
        if (!snapshot.nextCursor) {
          stopMigration();
          break;
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Migration failed");
      stopMigration();
    }
  }, [maxCreatedAt, minCreatedAt, parseCreatedAtMillis, runBatch, stopMigration]);

  const progressPercent = Math.min(100, Math.max(0, Math.round((stats?.progress ?? 0) * 100)));

  if (stackAdminApp.projectId !== "internal") {
    return notFound();
  }

  return (
    <PageLayout
      title="ClickHouse Event Migration"
      description="Backfill historical events from Postgres into ClickHouse. Intended for internal use only."
      fillWidth
    >
      <div className="flex flex-col gap-4">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Typography type="label">Min created at (unix millis or ISO/datetime-local)</Typography>
                <Input
                  type="text"
                  value={minCreatedAt}
                  onChange={(e) => {
                    setMinCreatedAt(e.target.value);
                    resetMigration();
                  }}
                  placeholder="1735689600000 or 2024-08-01T00:00"
                />
              </div>
              <div className="space-y-2">
                <Typography type="label">Max created at (use to exclude new dual-written events)</Typography>
                <Input
                  type="text"
                  value={maxCreatedAt}
                  onChange={(e) => {
                    setMaxCreatedAt(e.target.value);
                    resetMigration();
                  }}
                  placeholder="1767225600000 or 2024-12-01T00:00"
                />
              </div>
              <div className="space-y-2">
                <Typography type="label">Batch size</Typography>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value) || 0);
                    resetMigration();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Typography type="label">Cursor</Typography>
                <Typography variant="secondary" className="text-sm break-all">
                  {cursor ? `${cursor.createdAtMillis} · ${cursor.id}` : "Not started"}
                </Typography>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">{error}</Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={startMigration} disabled={running} loading={running}>
                {running ? "Running" : "Start / Resume"}
              </Button>
              <Button onClick={stopMigration} variant="secondary" disabled={!running}>
                Stop
              </Button>
              <Button onClick={resetMigration} variant="ghost">
                Reset cursor
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-3 w-full rounded-full bg-muted">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Typography variant="secondary">Progress</Typography>
              <Typography type="label">{progressPercent}%</Typography>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Typography variant="secondary">Processed</Typography>
                <Typography type="label">{stats?.processedEvents ?? 0}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Remaining</Typography>
                <Typography type="label">{stats?.remainingEvents ?? 0}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Migrated this run</Typography>
                <Typography type="label">{stats?.migratedEvents ?? 0}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Inserted rows</Typography>
                <Typography type="label">{stats?.insertedRows ?? 0}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Total in scope</Typography>
                <Typography type="label">{stats?.totalEvents ?? 0}</Typography>
              </div>
              <div className="">
                <Typography variant="secondary">State</Typography>
                <Typography type="label">{running ? "Running" : "Idle"}</Typography>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
