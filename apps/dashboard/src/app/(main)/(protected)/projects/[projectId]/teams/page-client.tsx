"use client";
import { TeamTable } from "@/components/data-table/team-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { Button } from "@stackframe/stack-ui";
import React from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type CreateDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const teams = stackAdminApp.useTeams();

  const [createTeamsOpen, setCreateTeamsOpen] = React.useState(false);

  return (
    <AppEnabledGuard appId="teams">
      <PageLayout
        title="Teams"
        actions={
          <Button onClick={() => setCreateTeamsOpen(true)}>
            Create Team
          </Button>
        }>
        <TeamTable teams={teams} />
        <CreateDialog
          open={createTeamsOpen}
          onOpenChange={setCreateTeamsOpen}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function CreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const stackAdminApp = useAdminApp();


  const formSchema = yup.object({
    displayName: yup.string().defined().label("Display Name"),
  });

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create a Team"
      formSchema={formSchema}
      okButton={{ label: "Create" }}
      onSubmit={async (values) => {
        await stackAdminApp.createTeam({
          displayName: values.displayName,
        });
      }}
      cancelButton
    />
  );
}
