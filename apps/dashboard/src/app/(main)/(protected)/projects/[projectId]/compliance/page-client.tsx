"use client";

import {
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
} from "@/components/design-components";
import { Skeleton, Typography } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  ShieldWarningIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type ComplianceEvent = {
  event_at: string,
  category: "access_denied" | "sign_up_rule",
  reason: string | null,
  rule_id: string | null,
  email: string | null,
  auth_method: string | null,
  oauth_provider: string | null,
  permission_id: string | null,
  team_id: string | null,
  restricted_reason: string | null,
  ip: string | null,
  country_code: string | null,
  region_code: string | null,
  city_name: string | null,
  user_id: string | null,
};

type RestrictedUser = {
  id: string,
  primary_email: string | null,
  display_name: string | null,
  restricted_reason: string,
  signed_up_at: string,
};

type ComplianceData = {
  events: ComplianceEvent[],
  restricted_users: RestrictedUser[],
  summary: Record<string, number>,
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok", data: ComplianceData };

type HexclaveAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

function getStackAppInternals(appValue: unknown): HexclaveAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }
  const internals = Reflect.get(appValue, hexclaveAppInternalsSymbol);
  if (
    internals == null ||
    typeof internals !== "object" ||
    !("sendRequest" in internals) ||
    typeof (internals as HexclaveAppInternals).sendRequest !== "function"
  ) {
    throw new Error("The Stack client app cannot send internal requests.");
  }
  return internals as HexclaveAppInternals;
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange(): { from: string, to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: formatDateInput(from), to: formatDateInput(to) };
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}

function humanize(value: string | null): string {
  if (value == null || value.length === 0) return "—";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getEventLabel(event: ComplianceEvent): string {
  return event.category === "sign_up_rule" ? "Sign-up rule" : humanize(event.reason);
}

function getEventBadgeColor(event: ComplianceEvent): "red" | "orange" {
  return event.category === "sign_up_rule" ? "orange" : "red";
}

function csvValue(value: string | null): string {
  return `"${(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function downloadEventsCsv(events: ComplianceEvent[]): void {
  const headers = [
    "event_at",
    "category",
    "reason",
    "rule_id",
    "email",
    "auth_method",
    "oauth_provider",
    "permission_id",
    "team_id",
    "restricted_reason",
    "ip",
    "country_code",
    "region_code",
    "city_name",
    "user_id",
  ];
  const rows = events.map((event) => [
    event.event_at,
    event.category,
    event.reason,
    event.rule_id,
    event.email,
    event.auth_method,
    event.oauth_provider,
    event.permission_id,
    event.team_id,
    event.restricted_reason,
    event.ip,
    event.country_code,
    event.region_code,
    event.city_name,
    event.user_id,
  ].map(csvValue).join(","));
  const blob = new Blob([[headers.map(csvValue).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `compliance-events-${formatDateInput(new Date())}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PageClient() {
  return (
    <AppEnabledGuard appId="compliance">
      <PageLayout
        title="Compliance Center"
        description="Review access denials and export compliance evidence"
      >
        <ComplianceContent />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function ComplianceContent() {
  const app = useAdminApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const defaultRange = useMemo(getDefaultDateRange, []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!isValidDateInput(from) || !isValidDateInput(to) || from > to) return;

    let cancelled = false;
    runAsynchronously(async () => {
      setState({ status: "loading" });
      try {
        const params = new URLSearchParams({ from, to });
        const response = await appInternals.sendRequest(
          `/internal/compliance/access-denied?${params.toString()}`,
          { method: "GET" },
          "admin",
        );
        if (!response.ok) {
          throw new Error(`Failed to load compliance data: ${response.status}`);
        }
        const body = await response.json() as ComplianceData;
        if (!cancelled) setState({ status: "ok", data: body });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error" });
        captureError("compliance-load", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals, from, reloadKey, to]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Typography variant="secondary">Could not load compliance data. Please try again.</Typography>
          <DesignButton
            variant="secondary"
            size="sm"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <ArrowClockwiseIcon className="h-4 w-4" />
            Retry
          </DesignButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <ComplianceDashboard
      data={state.data}
      from={from}
      to={to}
      onFromChange={setFrom}
      onToChange={setTo}
    />
  );
}

function ComplianceDashboard({
  data,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  data: ComplianceData,
  from: string,
  to: string,
  onFromChange: (value: string) => void,
  onToChange: (value: string) => void,
}) {
  const total = data.events.length;
  const notableReasons = [
    ["failed_password", "Failed passwords"],
    ["permission_denied", "Permission denials"],
    ["oauth_provider_denied", "OAuth denials"],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-wrap items-end gap-3">
          <DateInput label="From" value={from} onChange={onFromChange} />
          <DateInput label="To" value={to} onChange={onToChange} />
        </div>
        <DesignButton
          size="sm"
          variant="secondary"
          disabled={total === 0}
          onClick={() => downloadEventsCsv(data.events)}
        >
          <DownloadSimpleIcon className="h-4 w-4" />
          Export CSV
        </DesignButton>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total activity" value={total} icon={<FileTextIcon className="h-4 w-4" />} />
        {notableReasons.map(([key, label]) => (
          <KpiCard
            key={key}
            label={label}
            value={data.summary[key] ?? 0}
            icon={<ShieldWarningIcon className="h-4 w-4 text-red-500" />}
          />
        ))}
      </div>

      <DesignCard
        title="Denial events"
        subtitle={`${total} event${total === 1 ? "" : "s"} in the selected date range`}
        icon={ShieldWarningIcon}
        gradient="orange"
        glassmorphic
      >
        {data.events.length === 0 ? (
          <EmptyState message="No access-denial or rejected-access activity in this date range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="border-b border-border/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Timestamp</th>
                  <th className="px-3 py-2 font-medium">Type / reason</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Auth</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">User ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.events.map((event, index) => (
                  <tr key={`${event.event_at}-${event.user_id ?? "anonymous"}-${index}`} className="transition-colors duration-150 hover:bg-foreground/[0.03] hover:transition-none">
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatTimestamp(event.event_at)}</td>
                    <td className="px-3 py-3">
                      <DesignBadge label={getEventLabel(event)} color={getEventBadgeColor(event)} size="sm" />
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3">{event.email ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{humanize(event.auth_method ?? event.oauth_provider)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted-foreground">{event.ip ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{[event.city_name, event.region_code, event.country_code].filter(Boolean).join(", ") || "—"}</td>
                    <td className="max-w-[180px] truncate px-3 py-3 font-mono text-[11px] text-muted-foreground">{event.user_id ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DesignCard>

      <DesignCard
        title="Currently restricted users"
        subtitle={`${data.restricted_users.length} restricted user${data.restricted_users.length === 1 ? "" : "s"} in the latest snapshot`}
        icon={UserIcon}
        gradient="blue"
        glassmorphic
      >
        {data.restricted_users.length === 0 ? (
          <EmptyState message="No currently restricted users." />
        ) : (
          <div className="divide-y divide-border/40">
            {data.restricted_users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Typography className="truncate text-sm font-medium">
                    {user.display_name ?? user.primary_email ?? user.id}
                  </Typography>
                  <Typography variant="secondary" className="truncate text-xs">
                    {user.primary_email ?? user.id}
                  </Typography>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Typography variant="secondary" className="hidden text-[11px] sm:block">
                    Since {new Date(user.signed_up_at).toLocaleDateString()}
                  </Typography>
                  <DesignBadge label={humanize(user.restricted_reason)} color="orange" size="sm" />
                </div>
              </div>
            ))}
          </div>
        )}
      </DesignCard>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <CalendarBlankIcon className="h-3.5 w-3.5" />
        {label}
      </span>
      <DesignInput type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-[150px] text-xs" />
    </label>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <Typography variant="secondary" className="text-xs">{message}</Typography>
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center gap-1.5">
          {icon}
          <Typography variant="secondary" className="truncate text-[11px] uppercase tracking-wide">{label}</Typography>
        </div>
        <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      </CardContent>
    </Card>
  );
}
