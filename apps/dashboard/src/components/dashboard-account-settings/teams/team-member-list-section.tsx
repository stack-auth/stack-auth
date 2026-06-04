'use client';

import { Team, useUser } from "@hexclave/next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { User } from "@phosphor-icons/react";

export function TeamMemberListSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const readMemberPermission = user.usePermission(props.team, '$read_members');

  if (!readMemberPermission) {
    return null;
  }

  return <MemberListSectionInner team={props.team} />;
}

function MemberListSectionInner(props: { team: Team }) {
  const users = props.team.useUsers();

  return (
    <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex flex-col gap-5">
      <div>
        <h3 className="font-semibold text-base text-foreground leading-snug">
          Team Members
        </h3>
        <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
          The users who have access to this team.
        </p>
      </div>

      <div className="border border-black/[0.06] dark:border-white/[0.06] rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-zinc-50/50 dark:bg-zinc-900/50">
            <TableRow className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <TableHead className="py-3 px-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider w-[80px]">Avatar</TableHead>
              <TableHead className="py-3 px-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center py-6 text-muted-foreground italic text-sm">
                  No members found
                </TableCell>
              </TableRow>
            ) : (
              users.map(({ id, teamProfile }) => {
                const initials = teamProfile.displayName?.slice(0, 2).toUpperCase() || '';
                return (
                  <TableRow key={id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 hover:bg-zinc-50/30 dark:hover:bg-zinc-900/30 transition-colors duration-150">
                    <TableCell className="py-3 px-4">
                      <Avatar className="h-9 w-9 border border-black/[0.08] dark:border-white/[0.08] shadow-sm">
                        <AvatarImage src={teamProfile.profileImageUrl || undefined} />
                        <AvatarFallback className="bg-zinc-100 dark:bg-zinc-900 text-foreground font-semibold text-xs">
                          {initials || <User className="h-4 w-4 text-zinc-500" />}
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-sm font-semibold text-foreground/90">
                      {teamProfile.displayName || (
                        <span className="text-muted-foreground italic font-normal text-xs">No display name set</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
