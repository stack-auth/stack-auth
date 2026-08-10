"use client";

import { AuditLogTable, type AuditLogEvent } from "@/components/data-table/audit-log-table";
import { Typography } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";

type AuditLogResponse = {
  items: AuditLogEvent[],
  pagination: {
    next_cursor: string | null,
  },
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok", data: AuditLogResponse };

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

export default function PageClient() {
  return (
    <AppEnabledGuard appId="audit-log">
      <PageLayout
        title="Audit Log"
        description="Timeline of sensitive admin actions in this project"
      >
        <AuditLogContent />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function AuditLogContent() {
  const app = useAdminApp();
  const projectId = useProjectId();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      setState({ status: "loading" });
      try {
        const response = await appInternals.sendRequest("/internal/audit-log", { method: "GET" }, "admin");
        if (!response.ok) {
          throw new Error(`Failed to load audit log: ${response.status}`);
        }
        const body = await response.json() as AuditLogResponse;
        if (!cancelled) setState({ status: "ok", data: body });
      } catch (e) {
        if (cancelled) return;
        setState({ status: "error" });
        captureError("audit-log-load", e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals]);

  if (state.status === "error") {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Typography variant="secondary">Could not load the audit log. Please try again.</Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <AuditLogTable
      events={state.status === "ok" ? state.data.items : []}
      projectId={projectId}
      isLoading={state.status === "loading"}
    />
  );
}
