"use client";
import { TeamTable } from "@/components/data-table/team-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { Button } from "@stackframe/stack-ui";
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { TeamInviteDialog } from "@/components/team-invite-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@stackframe/stack-ui";

type CreateDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const teams = stackAdminApp.useTeams();

  const [createTeamsOpen, setCreateTeamsOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const selectedTeam = selectedTeamId ? stackAdminApp.useTeam(selectedTeamId) : null;

  return (
    <PageLayout
      title="Teams"
      actions={
        <div className="flex gap-2">
          <Button onClick={() => setCreateTeamsOpen(true)}>Create Team</Button>
          <div className="flex items-center gap-2">
            <Select onValueChange={(v) => setSelectedTeamId(v)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select team" /></SelectTrigger>
              <SelectContent>
                {teams.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!selectedTeam} onClick={() => setInviteOpen(true)}>Invite to team</Button>
          </div>
        </div>
      }>
      <TeamTable teams={teams} />
      {selectedTeam && (
        <TeamInviteDialog team={selectedTeam} open={inviteOpen} onOpenChange={setInviteOpen} />
      )}
      <CreateDialog
        open={createTeamsOpen}
        onOpenChange={setCreateTeamsOpen}
      />
    </PageLayout>
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
