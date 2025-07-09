"use client";

import { stackAppInternalsSymbol } from "@/app/(main)/integrations/transfer-confirm-page";
import { UserTable } from "@/components/data-table/user-table";
import { StyledLink } from "@/components/link";
import { UserDialog } from "@/components/user-dialog";
import { Alert, Button } from "@stackframe/stack-ui";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const data = (stackAdminApp as any)[stackAppInternalsSymbol].useMetrics();
  const firstUser = stackAdminApp.useUsers({ limit: 1 });

  return (
    <PageLayout
      title="Users"
      description={`Total: ${data.total_users}`}
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
  );
}
