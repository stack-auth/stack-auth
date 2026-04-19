"use client";

import { UserTable } from "@/components/data-table/user-table";
import { ExportUsersDialog } from "@/components/export-users-dialog";
import { StyledLink } from "@/components/link";
import { Alert, Button, SimpleTooltip, Skeleton } from "@/components/ui";
import { UserDialog } from "@/components/user-dialog";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { ArrowsClockwiseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Suspense, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const capturedUsersMetricsErrors = new WeakSet<Error>();

function captureUsersMetricsErrorOnce(error: Error) {
  if (capturedUsersMetricsErrors.has(error)) {
    return;
  }
  capturedUsersMetricsErrors.add(error);
  captureError("users-total-metrics-error-boundary", error);
}

function TotalUsersDisplay() {
  const stackAdminApp = useAdminApp();
  const metrics = (stackAdminApp as any)[stackAppInternalsSymbol].useMetrics(false);
  const metricsIncludingAnonymous = (stackAdminApp as any)[stackAppInternalsSymbol].useMetrics(true);

  const anonymousUsersCount = metricsIncludingAnonymous.total_users - metrics.total_users;

  return (
    <>
      {metrics.total_users}
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

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const firstUser = (stackAdminApp as any).useUsers({ limit: 1 });
  const [exportOptions, setExportOptions] = useState<{
    search?: string,
    includeRestricted: boolean,
    includeAnonymous: boolean,
    onlyAnonymous: boolean,
  }>({ includeRestricted: false, includeAnonymous: false, onlyAnonymous: false });
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    await (stackAdminApp as any)._refreshUsers();
    setRefreshKey((k) => k + 1);
  };

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Users"
        description={<>
          Total:{" "}
          <ErrorBoundary errorComponent={TotalUsersErrorComponent}>
            <Suspense fallback={<Skeleton className="inline"><span>Calculating</span></Skeleton>}>
              <TotalUsersDisplay key={refreshKey} />
            </Suspense>
          </ErrorBoundary>
        </>}
        actions={
          <div className="flex gap-2">
            <SimpleTooltip tooltip="Refresh">
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <ArrowsClockwiseIcon className="h-4 w-4" />
              </Button>
            </SimpleTooltip>
            <ExportUsersDialog
              trigger={
                <Button variant="outline">
                  <DownloadSimpleIcon className="mr-2 h-4 w-4" />
                  Export
                </Button>
              }
              exportOptions={exportOptions}
            />
            <UserDialog
              type="create"
              trigger={<Button>Create User</Button>}
            />
          </div>
        }
      >
        {firstUser.length > 0 ? null : (
          <Alert variant='success'>
            Congratulations on starting your project! Check the <StyledLink href="https://docs.stack-auth.com">documentation</StyledLink> to add your first users.
          </Alert>
        )}

        <div data-walkthrough="users-table">
          <UserTable key={refreshKey} onFilterChange={setExportOptions} />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
