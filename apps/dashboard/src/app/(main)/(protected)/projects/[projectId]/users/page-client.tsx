"use client";

import { stackAppInternalsSymbol } from "@/app/(main)/integrations/transfer-confirm-page";
import { UserTable } from "@/components/data-table/user-table";
import { ExportUsersDialog } from "@/components/export-users-dialog";
import { StyledLink } from "@/components/link";
import { UserDialog } from "@/components/user-dialog";
import { Alert, Button, Skeleton } from "@stackframe/stack-ui";
import { Download } from "lucide-react";
import { Suspense, useState } from "react";
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
    includeAnonymous: boolean,
  }>({ includeAnonymous: false });

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Users"
        description={<>
          Total:{" "}
          <Suspense fallback={<Skeleton className="inline"><span>Calculating</span></Skeleton>}>
            <TotalUsersDisplay />
          </Suspense>
        </>}
        actions={
          <div className="flex gap-2">
            <ExportUsersDialog
              trigger={
                <Button variant="outline">
                  <Download className="mr-2 h-4 w-4" />
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

        <UserTable onFilterChange={setExportOptions} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
