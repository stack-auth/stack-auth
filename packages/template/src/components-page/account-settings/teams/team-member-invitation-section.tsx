import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { Team } from "../../..";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useStackApp, useUser } from "../../../lib/hooks";
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
  const stackApp = useStackApp();
  const { t } = useTranslation();
  const invitationsToShow = props.team.useInvitations();

  const removeMemberPermission = user.usePermission(props.team, '$remove_members');
  const [rolePermissions, setRolePermissions] = useState<{ id: string, description?: string }[]>([]);
  const project = stackApp.useProject();

  // Fetch available role-based permissions to map permission_ids to role names
  useEffect(() => {
    const fetchRolePermissions = async () => {
      try {
        console.log('Fetching role permissions...');
        const permissions = await project.listTeamPermissionDefinitions();
        console.log('Role permissions fetched:', permissions);
        setRolePermissions(permissions);
      } catch (error) {
        console.error('Failed to fetch role permissions:', error);
      }
    };

    fetchRolePermissions().catch(() => {
      // Error already logged in fetchRolePermissions
    });
  }, [project]);

  const getRoleDisplayName = (permissionIds: string[]) => {
    if (permissionIds.length === 0) {
      return t("Default member role");
    }

    // Filter out permission IDs that start with $
    const filteredPermissionIds = permissionIds.filter(id => !id.startsWith('$'));
    if (filteredPermissionIds.length === 0) {
      return t("Default member role");
    }

    // Map permission IDs to their IDs (instead of descriptions)
    const roleMap = new Map(rolePermissions.map(role => [role.id, role.id]));


    // Find the role that matches the permission IDs and return the ID
    const matchingRoles = filteredPermissionIds.map(id => roleMap.get(id)).filter(Boolean);


    if (matchingRoles.length > 0) {
      const roleId = matchingRoles[0];
      // Map common roles to friendly names
      if (roleId === 'team_admin') return 'Admin';
      if (roleId === 'team_member') return 'Member';
      return roleId;
    }

    // Fallback to permission ID with mapping
    const firstPermissionId = filteredPermissionIds[0];
    if (firstPermissionId === 'team_admin') return 'Admin';
    if (firstPermissionId === 'team_member') return 'Member';
    return firstPermissionId;
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
  const stackApp = useStackApp();
  const { t } = useTranslation();
  const readMemberPermission = user.usePermission(props.team, '$read_members');
  const [rolePermissions, setRolePermissions] = useState<{ id: string, description?: string }[]>([]);
  const project = stackApp.useProject();

  const invitationSchema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email address')).defined().nonEmpty(t('Please enter an email address')),
    role: yupString().optional(),
  });

  const { register, handleSubmit, formState: { errors }, watch, setValue, watch: watchForm } = useForm({
    resolver: yupResolver(invitationSchema),
    defaultValues: {
      email: '',
      role: '',
    }
  });
  const [loading, setLoading] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  // Fetch available role-based permissions
  useEffect(() => {
    const fetchRolePermissions = async () => {
      try {
        const permissions = await project.listTeamPermissionDefinitions();
        setRolePermissions(permissions);
      } catch (error) {
        console.error('Failed to fetch role permissions:', error);
      }
    };

    fetchRolePermissions().catch(() => {
      // Error already logged in fetchRolePermissions
    });
  }, [project]);

  const onSubmit = async (data: yup.InferType<typeof invitationSchema>) => {
    setLoading(true);

    try {
      const permissionIds = data.role ? [data.role] : undefined;
      await props.team.inviteUser({
        email: data.email,
        permissionIds
      });
      setInvitedEmail(data.email);
      // Reset form
      setValue('email', '');
      setValue('role', '');
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
          <div className="flex flex-col gap-4 sm:flex-row w-full items-start">
            <div className="flex-1">
              <Input
                placeholder={t("Email")}
                {...register("email")}
              />
            </div>
            <div className="flex-1">
              <Select onValueChange={(value) => setValue('role', value)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Select role")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("Default member role")}</SelectItem>
                  {rolePermissions.filter(permission => !permission.id.startsWith('$')).map((permission) => (
                    <SelectItem key={permission.id} value={permission.id}>
                      {permission.id === 'team_admin' ? 'Admin' :
                        permission.id === 'team_member' ? 'Member' :
                          permission.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
