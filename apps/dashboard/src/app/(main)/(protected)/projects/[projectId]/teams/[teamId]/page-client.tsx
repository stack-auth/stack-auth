"use client";
import { TeamMemberSearchTable } from '@/components/data-table/team-member-search-table';
import { TeamMemberTable } from '@/components/data-table/team-member-table';
import { InputField } from '@/components/form-fields';
import { yupResolver } from '@hookform/resolvers/yup';
import { ServerTeam } from '@stackframe/stack';
import { strictEmailSchema, yupObject } from '@stackframe/stack-shared/dist/schema-fields';
import { runAsynchronouslyWithAlert } from '@stackframe/stack-shared/dist/utils/promises';
import { ActionDialog, Button, Form, Separator } from '@stackframe/stack-ui';
import { notFound } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import { PageLayout } from '../../page-layout';
import { useAdminApp } from '../../use-admin-app';

const inviteFormSchema = yupObject({
  email: strictEmailSchema("Please enter a valid email address").defined(),
});

export function AddUserDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
  team: ServerTeam,
}) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const teamUsers = props.team.useUsers();
  const inviteForm = useForm({
    resolver: yupResolver(inviteFormSchema),
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (values: yup.InferType<typeof inviteFormSchema>, e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    try {
      const domain = project.config.domains[0]?.domain;
      if (!domain) {
        // TODO don't use JS alert for this, make the UX nicer
        alert("You must configure at least one domain for this project before you can invite users.");
        return;
      }
      await props.team.inviteUser({
        email: values.email,
        callbackUrl: new URL(adminApp.urls.teamInvitation, domain).toString(),
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return <ActionDialog
    title="Add a user"
    trigger={props.trigger}
  >
    <h3 className="font-semibold mb-4">Invite a new user</h3>
    <Form {...inviteForm}>
      <form onSubmit={e => runAsynchronouslyWithAlert(inviteForm.handleSubmit(onSubmit)(e))} onChange={() => setSubmitted(false)}>
        <div className="flex flex-row gap-4">
          <InputField control={inviteForm.control} className="flex-1" name="email" placeholder="Email" />
          <Button loading={submitting} type="submit" disabled={submitted}>
            {submitted ? 'Invited!' : 'Invite'}
          </Button>
        </div>
      </form>
    </Form>
    <div className="flex items-center justify-center my-6 stack-scope">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-zinc-500">OR</div>
      <div className="flex-1">
        <Separator />
      </div>
    </div>
    <h3 className="font-semibold mb-4">Add an existing user</h3>
    <TeamMemberSearchTable
      action={(user) =>
        <div className="w-[100px] flex justify-center">
          <Button
            variant="outline"
            disabled={teamUsers.find(u => u.id === user.id) !== undefined}
            onClick={async () => {
              await props.team.addUser(user.id);
            }}
          >
            {teamUsers.find(u => u.id === user.id) ? 'Added' : 'Add'}
          </Button>
        </div>}
    />
  </ActionDialog>;
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
