"use client";

import { stackAppInternalsSymbol } from "@/app/(main)/integrations/transfer-confirm-page";
import { UserTable } from "@/components/data-table/user-table";
import { StyledLink } from "@/components/link";
import { UserDialog } from "@/components/user-dialog";
import { Alert, Button, Skeleton } from "@stackframe/stack-ui";
import { Suspense } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function TotalUsersDisplay() {
  const stackAdminApp = useAdminApp();
  const data = (stackAdminApp as any)[stackAppInternalsSymbol].useMetrics();

  return <>{data.total_users}</>;
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const firstUser = stackAdminApp.useUsers({ limit: 1 });

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
        actions={<UserDialog
          type="create"
          trigger={<Button>Create User</Button>}
        />}
      >
        {firstUser.length > 0 ? null : (
          <Alert variant='success'>
            Congratulations on starting your project! Check the <StyledLink href="https://docs.stack-auth.com">documentation</StyledLink> to add your first users.
          </Alert>
        )}

        <UserTable />
      </PageLayout>
    </AppEnabledGuard>
  );
}
