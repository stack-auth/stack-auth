import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
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

  return (
    <div>
      <Typography className='font-medium mb-2'>{t("Members")}</Typography>
      <div className='border rounded-md'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">{t("User")}</TableHead>
              <TableHead className="w-[200px]">{t("Name")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(({ id, teamProfile }, i) => (
              <TableRow key={id}>
                <TableCell>
                  <UserAvatar user={teamProfile} />
                </TableCell>
                <TableCell>
                  <Typography>{teamProfile.displayName}</Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
