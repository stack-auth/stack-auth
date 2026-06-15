import { Button } from "~/components/ui";

import { useState } from "react";
import { Team, useUser } from "@hexclave/react";
import {
  getButtonRadiusClassName,
  getOutlineButtonClassName,
  useDesign,
} from "../design-context";
import { Section } from "../section";
import { cn } from "~/components/ui";

export function LeaveTeamSection(props: { team: Team }) {
  const design = useDesign();
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
            className={getOutlineButtonClassName(design, "px-4 py-2 w-full transition-colors duration-150 text-red-500 hover:text-red-600")}
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
                className={cn(getButtonRadiusClassName(design), "flex-1 text-xs")}
              >
                Leave
              </Button>
              <Button
                variant="outline"
                onClick={() => setLeaving(false)}
                className={getOutlineButtonClassName(design, "flex-1 text-xs")}
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
