"use client";

import { SelectedTeamSwitcher, useUser } from "@stackframe/stack";

export default function TeamPage({ params }: { params: { teamId: string } }) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(params.teamId);

  if (!team) {
    return <div>Team not found</div>;
  }

  return (
    <div>
      <SelectedTeamSwitcher
        urlMap={team => `/team/${team.id}`}
        selectedTeam={team}
      />

      <p>Team Name: {team.displayName}</p>
      <p>You are a member of this team.</p>
    </div>
  );
}
