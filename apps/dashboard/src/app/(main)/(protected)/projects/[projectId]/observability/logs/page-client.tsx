"use client";

import { Link } from "@/components/link";
import { DesignButton, DesignPillToggle, DesignSelectorDropdown } from "@/components/design-components";
import { Button, Typography } from "@/components/ui";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { AnalyticsEventLimitBanner, RowDetailDialog } from "../../analytics/shared";
import {
  QueryDataGrid,
  type QueryDataGridColumnConfig,
  type QueryDataGridToolbarContext,
} from "../../analytics/tables/query-data-grid";
import type { RowData } from "../../analytics/shared";
import {
  parseServiceIdentityRow,
  selectValueToServiceIdentity,
  serviceIdentityEquals,
  serviceIdentityLabel,
  serviceIdentityToSelectValue,
  type ServiceIdentity,
} from "../service-identity";
import { ALL_SERVICES_SELECT_VALUE, isObservabilityTimeRangeHours, OBSERVABILITY_TIME_RANGE_OPTIONS, parseObservabilityTimeRangeId, useServiceIdentityLoader } from "../filters";
import { tryParseJson } from "../format";
import { LogLevelChip } from "../log-level";
import { issueSearchHref } from "../issues/issue-links";

export const DEFAULT_LOG_TIME_RANGE_HOURS = 720;

export const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const ALL_LEVELS_SELECT_VALUE = "all";

export function selectValueToLogLevel(value: string): LogLevel | null {
  if (value === ALL_LEVELS_SELECT_VALUE) return null;
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (level == null) throw new Error(`Unexpected log level select value: ${value}`);
  return level;
}

/**
 * Distinct services that have actually emitted `$log` rows. Sourced from the
 * logs themselves (not `trace_services`) so the dropdown never offers a
 * service that would empty the grid.
 */
export const LOG_SERVICES_QUERY = `
SELECT service_namespace, service_name
FROM default.logs
WHERE 1 = 1
  AND service_name IS NOT NULL
  AND service_name != ''
GROUP BY service_namespace, service_name
ORDER BY service_namespace ASC, service_name ASC
LIMIT 500
`;

/**
 * Logs are rows in the dedicated log store, written both by explicit
 * `app.logger.*` calls and by the SDK's automatic console warn/error capture.
 *
 * The `event_at` bound exists to bound the scan: without it every load walks
 * the project's entire events history. `hours` and `level` are interpolated
 * rather than bound parameters because they come from fixed UI sets; the
 * guards restrict both so this can never become an injection surface.
 * Both parts of the logical service identity are free-form strings from
 * ingested data, so both ride as ClickHouse query parameters.
 *
 * The users join resolves the User column to a display name/email the same
 * way the traces list does — the raw id stays available for the detail view.
 */
export function getLogsQuery(
  hours: number,
  level: LogLevel | null = null,
  service: ServiceIdentity | null = null,
): {
  query: string,
  params: Record<string, string | number>,
} {
  if (!isObservabilityTimeRangeHours(hours)) {
    throw new Error(`Unknown logs time range: ${hours}`);
  }
  if (level != null && !LOG_LEVELS.includes(level)) {
    throw new Error(`Unknown log level: ${level}`);
  }
  // `level` is the normalized product projection. A vanilla OTLP exporter may
  // provide only severity_text, so use it when the projection is empty.
  const levelExpression = "coalesce(nullIf(e.level, ''), nullIf(lowerUTF8(e.severity_text), ''), '')";
  const levelCondition = level == null ? "" : `\n  AND ${levelExpression} = '${level}'`;
  const serviceCondition = service == null ? "" : `
  AND coalesce(e.service_namespace, '') = {serviceNamespace:String}
  AND e.service_name = {serviceName:String}`;
  return {
    query: `
SELECT
  e.event_at,
  ${levelExpression} AS level,
  e.body AS message,
  e.service_namespace,
  e.service_name,
  e.deployment_environment_name,
  e.user_id,
  u.display_name AS user_display_name,
  u.primary_email AS user_primary_email,
  e.data,
  e.trace_id,
  e.span_id,
  e.session_replay_id,
  e.session_replay_segment_id,
  e.refresh_token_id
FROM default.logs AS e
LEFT JOIN default.users AS u ON toString(u.id) = e.user_id
WHERE e.event_at >= now64(3) - INTERVAL ${hours} HOUR${levelCondition}${serviceCondition}
`,
    params: {
      ...(service == null ? {} : {
        serviceNamespace: service.namespace,
        serviceName: service.name,
      }),
    },
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function userLabel(row: RowData): string | null {
  const userId = stringOrNull(row.user_id);
  if (userId == null) return null;
  return stringOrNull(row.user_display_name) ?? stringOrNull(row.user_primary_email) ?? userId;
}

// The grid renders Time | Level | Message | Service | Environment | User;
// everything else selected by getLogsQuery is hidden here but stays on the
// row object for quick search, the detail dialog, and its linked resources.
const LOG_COLUMN_CONFIGS = new Map<string, QueryDataGridColumnConfig>([
  ["event_at", { header: "Time", width: 170 }],
  ["level", {
    header: "Level",
    width: 90,
    renderCell: (value) => <LogLevelChip level={typeof value === "string" ? value : ""} />,
  }],
  ["message", {
    header: "Message",
    width: 320,
    flex: 1,
    renderCell: (value) => {
      const message = stringOrNull(value);
      if (message == null) return <span className="text-muted-foreground/50">—</span>;
      return <span className="block truncate font-mono text-xs" title={message}>{message}</span>;
    },
  }],
  ["service_name", {
    header: "Service",
    width: 140,
    renderCell: (_value, row) => {
      const service = parseServiceIdentityRow(row);
      const label = serviceIdentityLabel(service);
      return <span className="block truncate text-xs" title={label}>{label}</span>;
    },
  }],
  ["service_namespace", { hidden: true }],
  ["deployment_environment_name", { header: "Environment", width: 130 }],
  ["user_id", {
    header: "User",
    width: 200,
    renderCell: (_value, row) => {
      const label = userLabel(row);
      if (label == null) return <span className="text-muted-foreground/50">—</span>;
      return <span className="block truncate text-xs" title={label}>{label}</span>;
    },
  }],
  ["data", { hidden: true }],
  ["trace_id", { hidden: true }],
  ["span_id", { hidden: true }],
  ["session_replay_id", { hidden: true }],
  ["session_replay_segment_id", { hidden: true }],
  ["refresh_token_id", { hidden: true }],
  ["user_display_name", { hidden: true }],
  ["user_primary_email", { hidden: true }],
]);

// Detail dialog layout: readable fields first, correlation ids collapsed.
// Explicit lists (rather than Object.keys) keep the internal row-id key and
// the users-join helper columns out of the dialog.
const LOG_DETAIL_MAIN_COLUMNS = [
  "message",
  "level",
  "event_at",
  "service_namespace",
  "service_name",
  "deployment_environment_name",
  "user_id",
  "data",
] as const;
export const LOG_DETAIL_TECHNICAL_COLUMNS = [
  "trace_id",
  "span_id",
  "session_replay_id",
  "session_replay_segment_id",
  "refresh_token_id",
] as const;

function LogDetailExtraContent({ row, projectId }: { row: RowData, projectId: string }) {
  const userId = stringOrNull(row.user_id);
  const replayId = stringOrNull(row.session_replay_id);
  const data = tryParseJson(row.data);
  const fingerprint = typeof data === "object" && data != null && "error_fingerprint" in data
    ? stringOrNull(data.error_fingerprint)
    : null;
  const message = stringOrNull(row.message);

  if (userId == null && replayId == null && fingerprint == null) return null;

  return (
    <div className="space-y-3">
      {fingerprint != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-500/5 px-3 py-2 text-xs ring-1 ring-red-500/20">
          <span className="font-medium text-red-700 dark:text-red-400">Error fingerprint:</span>
          <code className="font-mono text-foreground">{fingerprint}</code>
          {/*
            Seeds the Issues search with the log's message rather than the
            fingerprint. The fingerprint here is the SDK's client-side djb2
            hash, which is NOT the server-side issue hash and has no stored
            mapping to one — searching for it would reliably return nothing.
            Issue search covers the exception type, value, and culprit, so the
            message is the field most likely to actually land on the right
            issue. A direct fingerprint → issue_hash link needs the correlation
            map that is deliberately out of scope here.
          */}
          {message != null && (
            <Button size="sm" variant="outline" asChild className="ml-auto h-6 px-2 text-[11px]">
              <Link href={issueSearchHref(projectId, message)}>View issue</Link>
            </Button>
          )}
        </div>
      )}
      {(userId != null || replayId != null) && (
        <div className="flex flex-wrap items-center gap-2">
          {userId != null && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(userId)}`}>
                View user
              </Link>
            </Button>
          )}
          {replayId != null && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/projects/${encodeURIComponent(projectId)}/session-replays/${encodeURIComponent(replayId)}`}>
                View session replay
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LogsEmptyState({ filterActive }: { filterActive: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
      <Typography className="font-medium">
        {filterActive ? "No matching logs" : "No logs yet"}
      </Typography>
      <Typography variant="secondary" className="max-w-lg text-sm">
        {filterActive
          ? "No logs match the selected filters in this time range. Clear a filter or widen the range."
          : <>
            Logs appear automatically once your app uses the SDK — console
            warnings and errors are captured with no setup. Log explicitly with{" "}
            <code className="rounded bg-foreground/[0.05] px-1 py-0.5 font-mono text-xs text-foreground">
              app.logger.info(...)
            </code>
            .
          </>}
      </Typography>
    </div>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [hours, setHours] = useState<number>(DEFAULT_LOG_TIME_RANGE_HOURS);
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [service, setService] = useState<ServiceIdentity | null>(null);
  const [services, setServices] = useState<ServiceIdentity[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<RowData | null>(null);
  const logsQuery = useMemo(() => getLogsQuery(hours, level, service), [hours, level, service]);

  const loadLogServices = useServiceIdentityLoader(adminApp, LOG_SERVICES_QUERY);

  useEffect(() => {
    let cancelled = false;
    setServicesLoading(true);
    runAsynchronouslyWithAlert(async () => {
      try {
        const nextServices = await loadLogServices();
        if (cancelled) return;
        setServices(nextServices);
        // Drop a selection that disappeared (e.g. after switching projects)
        // so the dropdown value always maps to a real option.
        setService((current) => (
          current == null || nextServices.some((candidate) => serviceIdentityEquals(candidate, current))
            ? current
            : null
        ));
      } finally {
        if (!cancelled) setServicesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadLogServices]);

  const refreshLogsAndServices = useCallback(async (reloadLogs: () => void) => {
    reloadLogs();
    const nextServices = await loadLogServices(true);
    setServices(nextServices);
    setService((current) => (
      current == null || nextServices.some((candidate) => serviceIdentityEquals(candidate, current))
        ? current
        : null
    ));
  }, [loadLogServices]);

  const renderToolbarExtra = useCallback(
    (context: QueryDataGridToolbarContext<RowData>) => (
      <span className="hidden h-[22px] shrink-0 items-center rounded-full bg-foreground/[0.04] px-2 text-[10px] tabular-nums text-muted-foreground ring-1 ring-foreground/[0.06] sm:inline-flex">
        {context.hasMore
          ? `${context.rowCount.toLocaleString()}+ logs`
          : `${context.rowCount.toLocaleString()} logs`}
      </span>
    ),
    [],
  );

  const renderToolbarActions = useCallback(
    (context: QueryDataGridToolbarContext<RowData>) => (
      <DesignButton
        variant="ghost"
        size="sm"
        loading={context.isRefetching}
        onClick={() => refreshLogsAndServices(context.reload)}
        className="gap-1.5"
      >
        <ArrowClockwiseIcon className="h-3.5 w-3.5" />
        Refresh
      </DesignButton>
    ),
    [refreshLogsAndServices],
  );

  const detailColumns = useMemo(() => {
    if (detailRow == null) return [];
    return [...LOG_DETAIL_MAIN_COLUMNS, ...LOG_DETAIL_TECHNICAL_COLUMNS]
      .filter((column) => column in detailRow);
  }, [detailRow]);

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout fillWidth noPadding containedHeight>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0">
            <AnalyticsEventLimitBanner />
          </div>

          <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-3 py-3">
            <div>
              <Typography type="h2" className="text-xl font-semibold tracking-tight">
                Logs
              </Typography>
              <Typography variant="secondary" className="mt-0.5 text-sm">
                Logs from your app — console warnings and errors are captured automatically.
              </Typography>
            </div>
            <div className="flex items-center gap-2">
              <DesignSelectorDropdown
                value={serviceIdentityToSelectValue(service)}
                onValueChange={(value) => setService(selectValueToServiceIdentity(value))}
                options={[
                  { value: ALL_SERVICES_SELECT_VALUE, label: "All services" },
                  ...services.map((identity) => ({
                    value: serviceIdentityToSelectValue(identity),
                    label: serviceIdentityLabel(identity),
                  })),
                ]}
                size="sm"
                disabled={servicesLoading}
              />
              <DesignSelectorDropdown
                value={level ?? ALL_LEVELS_SELECT_VALUE}
                onValueChange={(value) => setLevel(selectValueToLogLevel(value))}
                options={[
                  { value: ALL_LEVELS_SELECT_VALUE, label: "All levels" },
                  ...LOG_LEVELS.map((candidate) => ({
                    value: candidate,
                    label: candidate.charAt(0).toUpperCase() + candidate.slice(1),
                  })),
                ]}
                size="sm"
              />
              <DesignPillToggle
                selected={String(hours)}
                onSelect={(id) => setHours(parseObservabilityTimeRangeId(id))}
                options={OBSERVABILITY_TIME_RANGE_OPTIONS}
                size="sm"
                glassmorphic={false}
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <QueryDataGrid
              query={logsQuery.query}
              queryParams={logsQuery.params}
              mode="one-shot"
              defaultOrderBy="event_at"
              defaultOrderDir="desc"
              columnConfigs={LOG_COLUMN_CONFIGS}
              onRowClick={setDetailRow}
              toolbarExtra={renderToolbarExtra}
              toolbarActions={renderToolbarActions}
              exportFilename="logs-export"
              emptyState={<LogsEmptyState filterActive={level != null || service != null} />}
              fillHeight
              stickyTop={0}
              horizontalScrollbarPosition="top"
            />
          </div>
        </div>

        <RowDetailDialog
          row={detailRow}
          columns={detailColumns}
          open={detailRow != null}
          onOpenChange={(open) => {
            if (!open) setDetailRow(null);
          }}
          title="Log details"
          technicalColumns={LOG_DETAIL_TECHNICAL_COLUMNS}
          extraContent={detailRow == null ? null : (
            <LogDetailExtraContent row={detailRow} projectId={adminApp.projectId} />
          )}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
