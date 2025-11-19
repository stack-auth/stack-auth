import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { Team } from "../../..";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

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
  const { t } = useTranslation();
  const invitationsToShow = props.team.useInvitations();

  const removeMemberPermission = user.usePermission(props.team, '$remove_members');
  const getRoleDisplayName = (permissionIds: string[]) => {
    if (permissionIds.length === 0) {
      return t("Default member role");
    }

    const filteredPermissionIds = permissionIds.filter((id) => !id.startsWith('$'));
    const roleId = filteredPermissionIds[0] ?? permissionIds[0];

    if (roleId === 'team_admin') return t('Admin');
    if (roleId === 'team_member') return t('Member');
    return roleId;
  };

  return <>
    <Table className='mt-6'>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[200px]">{t("Outstanding invitations")}</TableHead>
          <TableHead className="w-[60px]">{t("Expires")}</TableHead>
          <TableHead className="w-[80px]">{t("Role")}</TableHead>
          <TableHead className="w-[36px] max-w-[36px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitationsToShow.map((invitation, i) => {

          return (
            <TableRow key={invitation.id}>
              <TableCell>
                <Typography>{invitation.recipientEmail}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant='secondary'>{invitation.expiresAt.toLocaleString()}</Typography>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{getRoleDisplayName(invitation.permissionIds || [])}</Badge>
              </TableCell>
              <TableCell align='right' className='max-w-[36px]'>
                {removeMemberPermission && (
                  <Button onClick={async () => await invitation.revoke()} size='icon' variant='ghost'>
                    <Trash className="w-4 h-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ); })}
        {invitationsToShow.length === 0 && <TableRow>
          <TableCell colSpan={4}>
            <Typography variant='secondary'>{t("No outstanding invitations")}</Typography>
          </TableCell>
        </TableRow>}
      </TableBody>
    </Table>
  </>;
}

function MemberInvitationSectionInner(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const { t } = useTranslation();
  const readMemberPermission = user.usePermission(props.team, '$read_members');

  const invitationSchema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email address')).defined().nonEmpty(t('Please enter an email address')),
  });

  const { register, handleSubmit, formState: { errors }, watch } = useForm({
    resolver: yupResolver(invitationSchema),
  });
  const [loading, setLoading] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  const onSubmit = async (data: yup.InferType<typeof invitationSchema>) => {
    setLoading(true);

    try {
      await props.team.inviteUser({ email: data.email });
      setInvitedEmail(data.email);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setInvitedEmail(null);
  }, [watch('email')]);

  return (
    <>
      <Section
        title={t("Invite member")}
        description={t("Invite a user to your team through email")}
      >
        <form
          onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
          noValidate
          className='w-full'
        >
          <div className="flex flex-col gap-4 sm:flex-row w-full">
            <Input
              placeholder={t("Email")}
              {...register("email")}
            />
            <Button type="submit" loading={loading}>{t("Invite User")}</Button>
          </div>
          <FormWarningText text={errors.email?.message?.toString()} />
          {invitedEmail && <Typography type='label' variant='secondary'>Invited {invitedEmail}</Typography>}
        </form>
      </Section>
      {readMemberPermission && <MemberInvitationsSectionInvitationsList team={props.team} />}
    </>
  );
}
