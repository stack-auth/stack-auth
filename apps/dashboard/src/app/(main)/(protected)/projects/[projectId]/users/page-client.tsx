"use client";

import { UserTable } from "@/components/data-table/user-table";
import { StyledLink } from "@/components/link";
import { Alert, Button, SimpleTooltip, Skeleton } from "@/components/ui";
import { UserDialog } from "@/components/user-dialog";
import {
  fetchMetricsOrThrow,
  fetchMetricsUserCountsOrThrow,
  type MetricsResponse,
  type MetricsUserCounts,
  useMetricsUserCountsOrThrow,
} from "@/lib/hexclave-app-internals";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Suspense, useCallback, useRef, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { UsersKpiCards } from "./users-kpi-cards";

const capturedUsersMetricsErrors = new WeakSet<Error>();

function captureUsersMetricsErrorOnce(error: Error) {
  if (capturedUsersMetricsErrors.has(error)) {
    return;
  }
  capturedUsersMetricsErrors.add(error);
  captureError("users-total-metrics-error-boundary", error);
}

function TotalUsersDisplay() {
  const hexclaveAdminApp = useAdminApp();
  const metrics = useMetricsUserCountsOrThrow(hexclaveAdminApp);
  return <TotalUsersText metrics={metrics} />;
}

function TotalUsersText(props: {
  metrics: MetricsUserCounts,
}) {
  const { metrics } = props;
  const anonymousUsersCount = metrics.anonymous_users;
  const nonAnonymousUsersCount = metrics.total_users - anonymousUsersCount;

  return (
    <>
      {nonAnonymousUsersCount}
      {anonymousUsersCount > 0 ? (
        <>
          {" "}(+ {anonymousUsersCount}{" "}
          <SimpleTooltip
            inline
            tooltip="When analytics are enabled, visitors that have not signed up yet are counted as anonymous users."
          >
            <span className="underline decoration-dotted underline-offset-2">anonymous visitors</span>
          </SimpleTooltip>
          )
        </>
      ) : null}
    </>
  );
}

function TotalUsersErrorComponent(props: { error: Error }) {
  captureUsersMetricsErrorOnce(props.error);
  return <>Unavailable</>;
}

type UsersMetricsSnapshot = {
  metrics: MetricsResponse,
  userCounts: MetricsUserCounts,
};

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const firstUserPage = hexclaveAdminApp.useUsers({ limit: 1 });
  const tableReloadRef = useRef<() => void>(() => {});
  const [usersMetricsSnapshot, setUsersMetricsSnapshot] = useState<UsersMetricsSnapshot | null>(null);

  const refreshUsersMetrics = useCallback(async () => {
    const [metrics, userCounts] = await Promise.all([
      fetchMetricsOrThrow(hexclaveAdminApp, false),
      fetchMetricsUserCountsOrThrow(hexclaveAdminApp),
    ]);
    setUsersMetricsSnapshot({ metrics, userCounts });
  }, [hexclaveAdminApp]);

  const handleTableReloadChange = useCallback((reload: () => void) => {
    tableReloadRef.current = reload;
  }, []);

  const handleUserMutated = useCallback(() => {
    tableReloadRef.current();
    runAsynchronouslyWithAlert(refreshUsersMetrics);
  }, [refreshUsersMetrics]);

  const handleRefresh = useCallback(async () => {
    tableReloadRef.current();
    await refreshUsersMetrics();
  }, [refreshUsersMetrics]);

  const hasUsers = usersMetricsSnapshot != null
    ? usersMetricsSnapshot.userCounts.total_users - usersMetricsSnapshot.userCounts.anonymous_users > 0
    : firstUserPage.length > 0;

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Users"
        description={<>
          Total:{" "}
          <ErrorBoundary errorComponent={TotalUsersErrorComponent}>
            {usersMetricsSnapshot != null ? (
              <TotalUsersText metrics={usersMetricsSnapshot.userCounts} />
            ) : (
              <Suspense fallback={<Skeleton className="inline"><span>Calculating</span></Skeleton>}>
                <TotalUsersDisplay />
              </Suspense>
            )}
          </ErrorBoundary>
        </>}
        actions={
          <div className="flex gap-2">
            <SimpleTooltip tooltip="Refresh">
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <ArrowsClockwiseIcon className="h-4 w-4" />
              </Button>
            </SimpleTooltip>
            <UserDialog
              type="create"
              trigger={<Button>Create User</Button>}
              onUserMutated={handleUserMutated}
            />
          </div>
        }
      >
        {hasUsers ? null : (
          <Alert variant='success'>
            Congratulations on starting your project! Check the <StyledLink href="https://docs.hexclave.com">documentation</StyledLink> to add your first users.
          </Alert>
        )}

        <UsersKpiCards metrics={usersMetricsSnapshot?.metrics} />

        <div data-walkthrough="users-table">
          <UserTable onUserMutated={handleUserMutated} onReloadChange={handleTableReloadChange} />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
