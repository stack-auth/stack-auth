"use client";

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Typography } from "@/components/ui";
import { ClickhouseMigrationRequest, ClickhouseMigrationResponse } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { notFound } from "next/navigation";
import React from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type MigrationCursor = {
  createdAtMillis: number,
  id: string,
};

type MigrationSnapshot = {
  migratedEvents: number,
  insertedRows: number,
  nextCursor: MigrationCursor | null,
};

const normalizeResponse = (response: ClickhouseMigrationResponse): MigrationSnapshot => ({
  migratedEvents: response.migrated_events,
  insertedRows: response.inserted_rows,
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
  const [cursor, setCursor] = React.useState<MigrationCursor | null>(null);
  const [running, setRunning] = React.useState(false);
  const runningRef = React.useRef(false);
  const cursorRef = React.useRef<MigrationCursor | null>(null);
  const timeWindowRef = React.useRef<{ minCreatedAtMillis: number, maxCreatedAtMillis: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [totalMigratedEvents, setTotalMigratedEvents] = React.useState(0);
  const [totalInsertedRows, setTotalInsertedRows] = React.useState(0);
  const [batchCount, setBatchCount] = React.useState(0);
  const [done, setDone] = React.useState(false);

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
    const safeLimit = limit;
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
    setTotalMigratedEvents(prev => prev + snapshot.migratedEvents);
    setTotalInsertedRows(prev => prev + snapshot.insertedRows);
    setBatchCount(prev => prev + 1);
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
    setError(null);
    setTotalMigratedEvents(0);
    setTotalInsertedRows(0);
    setBatchCount(0);
    setDone(false);
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
          setDone(true);
          stopMigration();
          break;
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Migration failed");
      stopMigration();
    }
  }, [maxCreatedAt, minCreatedAt, parseCreatedAtMillis, runBatch, stopMigration]);

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
                  max={100_000}
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
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Typography variant="secondary">Events migrated</Typography>
                <Typography type="label">{totalMigratedEvents.toLocaleString()}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Rows inserted</Typography>
                <Typography type="label">{totalInsertedRows.toLocaleString()}</Typography>
              </div>
              <div>
                <Typography variant="secondary">Batches completed</Typography>
                <Typography type="label">{batchCount.toLocaleString()}</Typography>
              </div>
              <div>
                <Typography variant="secondary">State</Typography>
                <Typography type="label">{done ? "Done" : running ? "Running" : "Idle"}</Typography>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
