'use client';

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Team, useUser } from "@hexclave/next";
import { Section } from "../section";

export function LeaveTeamSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const [leaving, setLeaving] = useState(false);

  return (
    <Section
      title="Leave Team"
      description="Leave this team and remove your team profile"
    >
      <div className="w-full md:w-[350px] flex flex-col items-stretch md:items-end">
        {!leaving ? (
          <Button
            variant="outline"
            onClick={() => setLeaving(true)}
            className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 py-2 w-full transition-colors duration-150 text-red-500 hover:text-red-600"
          >
            Leave team
          </Button>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            <span className="text-xs font-semibold text-red-500 leading-relaxed text-left md:text-right">
              Are you sure you want to leave the team? You will lose access to all of its resources.
            </span>
            <div className="flex gap-2 w-full">
              <Button
                variant="destructive"
                onClick={async () => {
                  await user.leaveTeam(props.team);
                  window.location.reload();
                }}
                className="rounded-xl flex-1 text-xs"
              >
                Leave
              </Button>
              <Button
                variant="outline"
                onClick={() => setLeaving(false)}
                className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl flex-1 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
