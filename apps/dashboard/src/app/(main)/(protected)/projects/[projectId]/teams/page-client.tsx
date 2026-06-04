"use client";
import { TeamTable } from "@/components/data-table/team-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { StyledLink } from "@/components/link";
import { Alert, Button } from "@/components/ui";
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

/**
 * @dashboardReference teams/teams
 * @dashboardReferenceDescription List, search, and manage teams for this project.
 *
 * ## Header
 *
 * - **Create Team** (top right) — opens a dialog with **Display Name** only; Hexclave assigns the team ID on create.
 *
 * ## Info banner
 *
 * When the project has **no teams yet**, an alert may link to **project membership** invites (`/projects?team_settings=…`) — that is for inviting dashboard collaborators, not the customer teams in this table.
 *
 * ## KPI cards (four)
 *
 * Sparkline metric cards above the table (from project analytics):
 *
 * - **New Active Teams** — recently active teams (new in the activity window)
 * - **Daily Active Teams** (DAT)
 * - **Returning Team Rate**
 * - **Total Teams** — all-time count
 *
 * ## Teams table (`DataGrid`)
 *
 * Paginated list (infinite scroll, 25 per page). Default sort: **Created At** descending. Toolbar **quick search** filters by team (server-side `listTeams` query). State syncs to URL (`teams` prefix).
 *
 * | Column | Notes |
 * | --- | --- |
 * | **ID** | Team UUID (monospace) |
 * | **Display Name** | Editable via row actions |
 * | **Created At** | Sortable |
 * | **Actions** | Row menu (see below) |
 *
 * **Row click** navigates to the team detail page (`/projects/…/teams/[teamId]`).
 *
 * ### Row action menu
 *
 * - **View Members** — same destination as row click
 * - **Edit** — change display name (ID shown read-only in dialog)
 * - **Create Checkout** — opens payments checkout dialog for this team (when Payments is in use)
 * - **Delete** — destructive; requires typing that removal cannot be undone (members are removed from the team)
 *
 * ## Team detail page (after row click)
 *
 * Separate route: edit display name inline, **Members** tab (invite by email, member table), **Metadata**, and sections for enabled apps (e.g. analytics, payments). Not rendered on this list page.
 *
 * Public integration guide: [Teams](https://docs.hexclave.com/docs/apps/teams).
 */
export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const teams = stackAdminApp.useTeams({ limit: 1 });
  const project = stackAdminApp.useProject();

  const [createTeamsOpen, setCreateTeamsOpen] = React.useState(false);
  const hasTeams = teams.length > 0;
  const teamSettingsPath = project.ownerTeamId ? `/projects?team_settings=${encodeURIComponent(project.ownerTeamId)}` : null;

  return (
    <AppEnabledGuard appId="teams">
      <PageLayout
        title="Teams"
        actions={
          <Button onClick={() => setCreateTeamsOpen(true)}>
            Create Team
          </Button>
        }>
        {!hasTeams && teamSettingsPath && (
          <Alert className="mb-6">
            Are you looking to invite a user to your project?{" "}
            <StyledLink href={teamSettingsPath}>Go here</StyledLink>.
          </Alert>
        )}
        <TeamsKpiCards />
        <div data-walkthrough="teams-table">
          <TeamTable />
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
