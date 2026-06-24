"use client";

import { UserTable } from "@/components/data-table/user-table";
import { StyledLink } from "@/components/link";
import { Alert, Button, SimpleTooltip, Skeleton } from "@/components/ui";
import { UserDialog } from "@/components/user-dialog";
import { useMetricsUserCountsOrThrow } from "@/lib/hexclave-app-internals";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Suspense, useState } from "react";
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

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const firstUserPage = hexclaveAdminApp.useUsers({ limit: 1 });
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    await (hexclaveAdminApp as any)._refreshUsers();
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
            <UserDialog
              type="create"
              trigger={<Button>Create User</Button>}
            />
          </div>
        }
      >
        {firstUserPage.length > 0 ? null : (
          <Alert variant='success'>
            Congratulations on starting your project! Check the <StyledLink href="https://docs.hexclave.com">documentation</StyledLink> to add your first users.
          </Alert>
        )}

        <UsersKpiCards />

        <div data-walkthrough="users-table">
          <UserTable key={refreshKey} />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
