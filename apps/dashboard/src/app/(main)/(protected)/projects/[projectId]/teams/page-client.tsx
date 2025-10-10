"use client";
import { TeamTable } from "@/components/data-table/team-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { Button } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type CreateDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export default function PageClient() {
  const t = useTranslations('teams');
  const stackAdminApp = useAdminApp();
  const teams = stackAdminApp.useTeams();

  const [createTeamsOpen, setCreateTeamsOpen] = React.useState(false);

  return (
    <PageLayout
      title={t('title')}
      actions={
        <Button onClick={() => setCreateTeamsOpen(true)}>
          {t('createTeam')}
        </Button>
      }>
      <TeamTable teams={teams} />
      <CreateDialog
        open={createTeamsOpen}
        onOpenChange={setCreateTeamsOpen}
      />
    </PageLayout>
  );
}

function CreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const t = useTranslations('teams.createDialog');
  const stackAdminApp = useAdminApp();


  const formSchema = yup.object({
    displayName: yup.string().defined().label(t('displayNameLabel')),
  });

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      formSchema={formSchema}
      okButton={{ label: t('createButton') }}
      onSubmit={async (values) => {
        await stackAdminApp.createTeam({
          displayName: values.displayName,
        });
      }}
      cancelButton
    />
  );
}
