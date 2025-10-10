"use client";

import { stackAppInternalsSymbol } from "@/app/(main)/integrations/transfer-confirm-page";
import { UserTable } from "@/components/data-table/user-table";
import { StyledLink } from "@/components/link";
import { UserDialog } from "@/components/user-dialog";
import { Alert, Button } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const t = useTranslations('users');
  const stackAdminApp = useAdminApp();
  const data = (stackAdminApp as any)[stackAppInternalsSymbol].useMetrics();
  const firstUser = stackAdminApp.useUsers({ limit: 1 });

  return (
    <PageLayout
      title={t('title')}
      description={`${t('total')}: ${data.total_users}`}
      actions={<UserDialog
        type="create"
        trigger={<Button>{t('createUser')}</Button>}
      />}
    >
      {firstUser.length > 0 ? null : (
        <Alert variant='success'>
          {t('welcomeMessage.start')} <StyledLink href="https://docs.stack-auth.com">{t('welcomeMessage.documentation')}</StyledLink> {t('welcomeMessage.end')}
        </Alert>
      )}

      <UserTable />
    </PageLayout>
  );
}
