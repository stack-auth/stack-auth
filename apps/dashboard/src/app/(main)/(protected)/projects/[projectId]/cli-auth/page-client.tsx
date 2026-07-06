"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignCard,
} from "@/components/design-components";
import { Skeleton, Typography } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import {
  CheckCircleIcon,
  ClockIcon,
  TerminalWindowIcon,
  UserIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useStackApp } from "@hexclave/next";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

type CliAuthSummary = {
  total_attempts: number,
  completed_attempts: number,
  used_attempts: number,
  expired_attempts: number,
  pending_attempts: number,
  active_tokens: number,
};

type CliAuthAttempt = {
  id: string,
  status: "pending" | "completed" | "expired" | "used",
  created_at: string,
  expires_at: string,
  used_at: string | null,
};

type CliAuthUser = {
  user_id: string,
  display_name: string | null,
  primary_email: string | null,
  token_created_at: string,
  last_active_at: string,
  expires_at: string | null,
  is_expired: boolean,
};

type CliAuthData = {
  summary: CliAuthSummary,
  recent_attempts: CliAuthAttempt[],
  active_cli_users: CliAuthUser[],
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok", data: CliAuthData };

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

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PageClient() {
  return (
    <AppEnabledGuard appId="cli-auth">
      <PageLayout title="CLI Auth" description="Monitor CLI authentication sessions and active tokens">
        <CliAuthContent />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function CliAuthContent() {
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      setState({ status: "loading" });
      try {
        const response = await appInternals.sendRequest("/internal/cli-auth", { method: "GET" }, "admin");
        if (!response.ok) {
          throw new Error(`Failed to load CLI auth data: ${response.status}`);
        }
        const body = await response.json() as CliAuthData;
        if (!cancelled) setState({ status: "ok", data: body });
      } catch (e) {
        if (cancelled) return;
        setState({ status: "error" });
        captureError("cli-auth-load", e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Typography variant="secondary">Could not load CLI auth data. Please try again.</Typography>
        </CardContent>
      </Card>
    );
  }

  return <CliAuthDashboard data={state.data} />;
}

function CliAuthDashboard({ data }: { data: CliAuthData }) {
  const { summary, recent_attempts, active_cli_users } = data;
  const activeUsers = active_cli_users.filter((u) => !u.is_expired);
  const expiredUsers = active_cli_users.filter((u) => u.is_expired);

  return (
    <div className="flex flex-col gap-4">
      <DesignAlert
        variant="info"
        title="About CLI Auth"
        description={<>
          CLI Auth allows users to authenticate from command-line tools using a browser-based login flow.
          The CLI initiates a session, the user confirms in a browser, and a refresh token is issued to the CLI.
        </>}
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Total" value={summary.total_attempts} icon={<TerminalWindowIcon className="h-4 w-4" />} />
        <KpiCard label="Used" value={summary.used_attempts} icon={<CheckCircleIcon className="h-4 w-4 text-emerald-500" />} />
        <KpiCard label="Ready" value={summary.completed_attempts} icon={<CheckCircleIcon className="h-4 w-4 text-blue-500" />} />
        <KpiCard label="Expired" value={summary.expired_attempts} icon={<XCircleIcon className="h-4 w-4 text-red-500" />} />
        <KpiCard label="Active tokens" value={summary.active_tokens} icon={<UserIcon className="h-4 w-4 text-blue-500" />} />
      </div>

      {/* Active CLI Users */}
      <DesignCard
        title="Active CLI Sessions"
        subtitle={`${activeUsers.length} user${activeUsers.length === 1 ? "" : "s"} with active CLI refresh tokens`}
        icon={UserIcon}
        glassmorphic
      >
        {activeUsers.length === 0 ? (
          <div className="py-6 text-center">
            <Typography variant="secondary" className="text-xs">No active CLI sessions.</Typography>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {activeUsers.map((user) => (
              <div key={`${user.user_id}-${user.token_created_at}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <Typography className="text-sm font-medium truncate">
                    {user.display_name ?? user.primary_email ?? user.user_id}
                  </Typography>
                  {user.primary_email && user.display_name && (
                    <Typography variant="secondary" className="text-xs truncate">{user.primary_email}</Typography>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex flex-col items-end gap-0.5">
                    <Typography variant="secondary" className="text-[11px]">
                      Active {formatRelativeTime(user.last_active_at)}
                    </Typography>
                    <Typography variant="secondary" className="text-[11px]">
                      {user.expires_at == null ? "No expiry" : `Expires ${new Date(user.expires_at).toLocaleDateString()}`}
                    </Typography>
                  </div>
                  <DesignBadge label="Active" color="green" size="sm" />
                </div>
              </div>
            ))}
          </div>
        )}
        {expiredUsers.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors hover:transition-none">
              {expiredUsers.length} expired session{expiredUsers.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 divide-y divide-border/40">
              {expiredUsers.map((user) => (
                <div key={`${user.user_id}-${user.token_created_at}`} className="flex items-center justify-between gap-3 py-2.5 opacity-60">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <Typography className="text-sm truncate">
                      {user.display_name ?? user.primary_email ?? user.user_id}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Typography variant="secondary" className="text-[11px]">
                      Expired {user.expires_at != null ? formatRelativeTime(user.expires_at) : ""}
                    </Typography>
                    <DesignBadge label="Expired" color="red" size="sm" />
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </DesignCard>

      {/* Recent Attempts */}
      <DesignCard
        title="Recent Login Attempts"
        subtitle="Last 50 CLI authentication attempts"
        icon={ClockIcon}
        glassmorphic
      >
        {recent_attempts.length === 0 ? (
          <div className="py-6 text-center">
            <Typography variant="secondary" className="text-xs">No CLI auth attempts yet.</Typography>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {recent_attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <AttemptStatusIcon status={attempt.status} />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <Typography className="text-xs font-mono truncate">{attempt.id.slice(0, 8)}</Typography>
                    <Typography variant="secondary" className="text-[11px]">
                      {formatRelativeTime(attempt.created_at)}
                    </Typography>
                  </div>
                </div>
                <AttemptStatusBadge status={attempt.status} />
              </div>
            ))}
          </div>
        )}
      </DesignCard>
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

function AttemptStatusIcon({ status }: { status: CliAuthAttempt["status"] }) {
  switch (status) {
    case "used": {
      return <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />;
    }
    case "completed": {
      return <CheckCircleIcon className="h-4 w-4 shrink-0 text-blue-500" />;
    }
    case "expired": {
      return <XCircleIcon className="h-4 w-4 shrink-0 text-red-500" />;
    }
    case "pending": {
      return <WarningCircleIcon className="h-4 w-4 shrink-0 text-amber-500" />;
    }
  }
}

function AttemptStatusBadge({ status }: { status: CliAuthAttempt["status"] }) {
  switch (status) {
    case "used": {
      return <DesignBadge label="Used" color="green" size="sm" />;
    }
    case "completed": {
      return <DesignBadge label="Ready" color="blue" size="sm" />;
    }
    case "expired": {
      return <DesignBadge label="Expired" color="red" size="sm" />;
    }
    case "pending": {
      return <DesignBadge label="Pending" color="orange" size="sm" />;
    }
  }
}
