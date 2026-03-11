"use client";

import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { UserTable } from "@/components/data-table/user-table";
import { ExportUsersDialog } from "@/components/export-users-dialog";
import { StyledLink } from "@/components/link";
import { Alert, Button, SimpleTooltip, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { UserDialog } from "@/components/user-dialog";
import { ArrowsClockwiseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Suspense, useCallback, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

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
          {" "}(+ {anonymousUsersCount} anonymous)
        </>
      ) : null}
    </>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const firstUser = (stackAdminApp as any).useUsers({ limit: 1 });
  const [exportOptions, setExportOptions] = useState<{
    search?: string,
    includeRestricted: boolean,
    includeAnonymous: boolean,
  }>({ includeRestricted: false, includeAnonymous: false });
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsSpinning(true);
    // _refreshUsers invalidates the SDK's internal caches (user list, metrics, etc.)
    // then bumping the key remounts components so they re-read from the refreshed caches
    runAsynchronously(
      (stackAdminApp as any)._refreshUsers().then(() => {
        setRefreshKey((k) => k + 1);
        setIsSpinning(false);
      })
    );
  }, [stackAdminApp]);

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Users"
        description={<>
          Total:{" "}
          <Suspense fallback={<Skeleton className="inline"><span>Calculating</span></Skeleton>}>
            <TotalUsersDisplay key={refreshKey} />
          </Suspense>
        </>}
        actions={
          <div className="flex gap-2">
            <SimpleTooltip tooltip="Refresh">
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <ArrowsClockwiseIcon className={cn("h-4 w-4", isSpinning && "animate-spin")} />
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

        <UserTable key={refreshKey} onFilterChange={setExportOptions} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
