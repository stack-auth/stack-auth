import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui";

import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { Team, useUser } from "@hexclave/react";
import { Section } from "../section";
import {
  getCardClassName,
  getFieldClassName,
  getInsetPanelClassName,
  getPrimaryButtonClassName,
  getSectionDescriptionClassName,
  getSectionTitleClassName,
  useDesign,
} from "../design-context";

export function TeamMemberInvitationSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const inviteMemberPermission = user.usePermission(props.team, '$invite_members');

  if (!inviteMemberPermission) {
    return null;
  }

  return <MemberInvitationSectionInner team={props.team} />;
}

function MemberInvitationsSectionInvitationsList(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const invitationsToShow = props.team.useInvitations();
  const removeMemberPermission = user.usePermission(props.team, '$remove_members');
  const design = useDesign();

  return (
    <div className={getCardClassName(design, "flex flex-col gap-5 mt-4")}>
      <div>
        <h3 className={getSectionTitleClassName(design)}>
          Outstanding Invitations
        </h3>
        <p className={getSectionDescriptionClassName(design)}>
          Sent invitations that are currently pending.
        </p>
      </div>

      <div className={getInsetPanelClassName(design)}>
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <TableHead className="py-3 px-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Email</TableHead>
              <TableHead className="py-3 px-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Expires</TableHead>
              <TableHead className="py-3 px-4 text-right w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitationsToShow.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground italic text-sm">
                  No outstanding invitations
                </TableCell>
              </TableRow>
            ) : (
              invitationsToShow.map((invitation) => (
                <TableRow key={invitation.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 hover:bg-zinc-50/30 dark:hover:bg-zinc-800/25 transition-colors duration-150">
                  <TableCell className="py-3 px-4 text-sm font-medium text-foreground/90">
                    {invitation.recipientEmail}
                  </TableCell>
                  <TableCell className="py-3 px-4 text-xs text-muted-foreground/80">
                    {new Date(invitation.expiresAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-3 px-4 text-right">
                    {removeMemberPermission && (
                      <Button
                        onClick={async () => { await invitation.revoke(); }}
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-red-950/25 rounded-lg transition-colors"
                      >
                        <Trash className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MemberInvitationSectionInner(props: { team: Team }) {
  const design = useDesign();
  const user = useUser({ or: 'redirect' });
  const readMemberPermission = user.usePermission(props.team, '$read_members');

  const invitationSchema = yupObject({
    email: strictEmailSchema('Please enter a valid email address').defined().nonEmpty('Please enter an email address'),
  });

  const { register, handleSubmit, formState: { errors }, watch, reset } = useForm({
    resolver: yupResolver(invitationSchema)
  });
  const [loading, setLoading] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const watchedEmail = watch('email');

  const onSubmit = async (data: yup.InferType<typeof invitationSchema>) => {
    setLoading(true);
    try {
      await props.team.inviteUser({ email: data.email });
      setInvitedEmail(data.email);
      reset();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setInvitedEmail(null);
  }, [watchedEmail]);

  return (
    <>
      <Section
        title="Invite member"
        description="Invite a user to your team through email"
      >
        <form
          onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
          noValidate
          className="flex flex-col gap-2 w-full md:w-[350px]"
        >
          <div className="flex gap-2 w-full">
            <Input
              placeholder="Email address"
              {...register("email")}
              className={getFieldClassName(design, "flex-1")}
            />
            <Button
              type="submit"
              loading={loading}
              className={getPrimaryButtonClassName(design, "px-4")}
            >
              Invite
            </Button>
          </div>
          {errors.email && (
            <span className="text-red-500 text-xs font-medium">{errors.email.message?.toString()}</span>
          )}
          {invitedEmail && (
            <span className="text-xs text-muted-foreground/80 font-medium">Successfully invited {invitedEmail}</span>
          )}
        </form>
      </Section>
      {readMemberPermission && <MemberInvitationsSectionInvitationsList team={props.team} />}
    </>
  );
}
