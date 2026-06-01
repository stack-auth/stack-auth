"use client";

import { useRouter } from "next/navigation";
import { useUser } from "@hexclave/next";

export default function TeamsPage() {
  const user = useUser({ or: 'redirect' });
  const teams = user.useTeams();
  const router = useRouter();
  const selectedTeam = user.selectedTeam;

  return (
    <div>
      {selectedTeam &&
        <button onClick={() => router.push(`/team/${selectedTeam.id}`)}>
          Most recent team
        </button>}

      <h2>All Teams</h2>
      {teams.map(team => (
        <button key={team.id} onClick={() => router.push(`/team/${team.id}`)}>
          Open {team.displayName}
        </button>
      ))}
    </div>
  );
}
