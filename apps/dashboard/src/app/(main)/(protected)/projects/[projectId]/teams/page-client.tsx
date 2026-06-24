"use client";
import { TeamTable } from "@/components/data-table/team-table";
import { ExportTeamsDialog, type ExportTeamsOptions } from "@/components/export-teams-dialog";
import { SmartFormDialog } from "@/components/form-dialog";
import { StyledLink } from "@/components/link";
import { Alert, Button } from "@/components/ui";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import React from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { TeamsKpiCards } from "./teams-kpi-cards";

type CreateDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const teams = hexclaveAdminApp.useTeams({ limit: 1 });
  const project = hexclaveAdminApp.useProject();

  const [createTeamsOpen, setCreateTeamsOpen] = React.useState(false);
  const [exportDialogOpen, setExportDialogOpen] = React.useState(false);
  const [exportOptions, setExportOptions] = React.useState<ExportTeamsOptions>({ createdAtOrder: "desc" });
  const hasTeams = teams.length > 0;
  const teamSettingsPath = project.ownerTeamId ? `/projects?team_settings=${encodeURIComponent(project.ownerTeamId)}` : null;
  const openExportDialog = React.useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  return (
    <AppEnabledGuard appId="teams">
      <PageLayout
        title="Teams"
        actions={
          <div className="flex gap-2">
            <ExportTeamsDialog
              trigger={
                <Button variant="outline">
                  <DownloadSimpleIcon className="mr-2 h-4 w-4" />
                  Export
                </Button>
              }
              exportOptions={exportOptions}
              open={exportDialogOpen}
              onOpenChange={setExportDialogOpen}
            />
            <Button onClick={() => setCreateTeamsOpen(true)}>
              Create Team
            </Button>
          </div>
        }>
        {!hasTeams && teamSettingsPath && (
          <Alert className="mb-6">
            Are you looking to invite a user to your project?{" "}
            <StyledLink href={teamSettingsPath}>Go here</StyledLink>.
          </Alert>
        )}
        <TeamsKpiCards />
        <div data-walkthrough="teams-table">
          <TeamTable onFilterChange={setExportOptions} onExportClick={openExportDialog} />
        </div>
        <CreateDialog
          open={createTeamsOpen}
          onOpenChange={setCreateTeamsOpen}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function CreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const hexclaveAdminApp = useAdminApp();
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
        await hexclaveAdminApp.createTeam({
          displayName: values.displayName,
        });
      }}
      cancelButton
    />
  );
}
