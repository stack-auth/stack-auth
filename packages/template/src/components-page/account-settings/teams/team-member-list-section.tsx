import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useMemo } from "react";
import { Team } from "../../..";
import { UserAvatar } from "../../../components/elements/user-avatar";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";

export function TeamMemberListSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const readMemberPermission = user.usePermission(props.team, '$read_members');
  const inviteMemberPermission = user.usePermission(props.team, '$invite_members');

  if (!readMemberPermission && !inviteMemberPermission) {
    return null;
  }

  return <MemberListSectionInner team={props.team} />;
}

function MemberListSectionInner(props: { team: Team }) {
  const { t } = useTranslation();
  const users = props.team.useUsers();

  const userRoles = useMemo(() => {
    const rolesMap = new Map<string, string>();

    for (const user of users) {
      // Use permissionIds directly from teamProfile
      const permissionIds = user.teamProfile.permissionIds;

      // Filter out $-prefixed permissions
      const filteredPermissions = permissionIds.filter((id: string) => !id.startsWith('$'));

      // Find matching role based to permission IDs
      let roleName = "Member";

      if (filteredPermissions.length > 0) {
        const roleId = filteredPermissions[0];
        if (roleId === 'team_admin') {
          roleName = "Admin";
        } else if (roleId === 'team_member') {
          roleName = "Member";
        } else {
          roleName = roleId;
        }
      }

      rolesMap.set(user.id, roleName);
    }

    return rolesMap;
  }, [users]);

  const getRoleDisplayName = (userId: string): string => {
    return userRoles.get(userId) || "Member";
  };

  return (
    <div>
      <Typography className='font-medium mb-2'>{t("Members")}</Typography>
      <div className='border rounded-md'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">{t("User")}</TableHead>
              <TableHead className="w-[200px]">{t("Name")}</TableHead>
              <TableHead className="w-[150px]">{t("Role")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(({ id, teamProfile }) => {
              const roleName = getRoleDisplayName(id);

              return (
                <TableRow key={id}>
                  <TableCell>
                    <UserAvatar user={teamProfile} />
                  </TableCell>
                  <TableCell>
                    {teamProfile.displayName && (
                      <Typography>{teamProfile.displayName}</Typography>
                    )}
                    {!teamProfile.displayName && (
                      <Typography className="text-muted-foreground italic">{t("No display name set")}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{roleName}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
