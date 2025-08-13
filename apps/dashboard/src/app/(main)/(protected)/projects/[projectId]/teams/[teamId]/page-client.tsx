"use client";
import { TeamMemberTable } from '@/components/data-table/team-member-table';
import { Button } from '@stackframe/stack-ui';
import { ServerTeam } from '@stackframe/stack';
import { notFound } from 'next/navigation';
import { PageLayout } from '../../page-layout';
import { useAdminApp } from '../../use-admin-app';
import { TeamInviteDialog } from '@/components/team-invite-dialog';

export function AddUserDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
  team: ServerTeam,
}) {
  return <TeamInviteDialog open={props.open} onOpenChange={props.onOpenChange} trigger={props.trigger} team={props.team} />;
}

export default function PageClient(props: { teamId: string }) {
  const stackAdminApp = useAdminApp();
  const team = stackAdminApp.useTeam(props.teamId);
  const users = team?.useUsers();

  if (!team) {
    return notFound();
  }

  return (
    <PageLayout
      title="Team Members"
      description={`Manage team members of "${team.displayName}"`}
      actions={
        <AddUserDialog trigger={<Button>Add a user</Button>} team={team} />
      }
    >
      <TeamMemberTable users={users || []} team={team} />
    </PageLayout>
  );
}
