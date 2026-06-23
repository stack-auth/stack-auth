import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue, Button, Skeleton } from "~/components/ui";

import React, { Suspense, useMemo } from "react";
import { Team, useStackApp } from "@hexclave/react";
import { TeamIcon } from "./team-icon";
import { Gear, Plus } from "@phosphor-icons/react";

import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";

type MockTeam = {
  id: string;
  displayName: string;
  profileImageUrl?: string | null;
};

type DashboardTeamSwitcherProps<AllowNull extends boolean = false> = {
  team?: Team;
  teamId?: string;
  teams?: Team[];
  allowNull?: AllowNull;
  nullLabel?: string;
  triggerClassName?: string;
  onChange?: (team: AllowNull extends true ? Team | null : Team) => Promise<void>;
  // Mock data props
  mockUser?: {
    team?: MockTeam;
  };
  mockTeams?: MockTeam[];
  mockProject?: {
    config: {
      clientTeamCreationEnabled: boolean;
    };
  };
};

const emptyTeams: Team[] = [];

export function DashboardTeamSwitcher<AllowNull extends boolean = false>(props: DashboardTeamSwitcherProps<AllowNull>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Fallback() {
  return <Skeleton className="h-9 w-full max-w-64 rounded-xl" />;
}

function setAccountSettingsHash(hash: string) {
  if (window.location.hash === hash) {
    return;
  }
  window.location.hash = hash;
}

function Inner<AllowNull extends boolean>(props: DashboardTeamSwitcherProps<AllowNull>) {
  const app = useStackApp();
  const project = app.useProject();
  const [open, setOpen] = React.useState(false);

  const rawTeams = props.teams ?? emptyTeams;
  const selectedTeam = props.team || rawTeams.find(team => team.id === props.teamId);
  const teams = useMemo(() => [...rawTeams].sort((a, b) => (b.id === selectedTeam?.id ? 1 : -1)), [rawTeams, selectedTeam]);

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={selectedTeam?.id || (props.allowNull ? 'null-sentinel' : undefined)}
      onValueChange={(value) => {
        runAsynchronouslyWithAlert(async () => {
          let team: Team | null = null;
          if (value !== 'null-sentinel') {
            team = teams.find(team => team.id === value) || null;
          }

          if (props.onChange) {
            await props.onChange(team as any);
          }
        });
      }}
    >
      <SelectTrigger className={props.triggerClassName}>
        <SelectValue placeholder="Select team" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-black/[0.08] dark:border-white/[0.08] shadow-md">
        {selectedTeam && (
          <SelectGroup>
            <SelectLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-1.5 flex items-center justify-between">
              <span>Current Team</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  setAccountSettingsHash(`#team-${selectedTeam.id}`);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <Gear className="h-3.5 w-3.5" />
              </Button>
            </SelectLabel>
            <SelectItem value={selectedTeam.id} className="rounded-lg">
              <div className="flex items-center gap-2">
                <TeamIcon team={selectedTeam} />
                <span className="max-w-[140px] truncate text-sm font-semibold text-foreground/90">{selectedTeam.displayName}</span>
              </div>
            </SelectItem>
          </SelectGroup>
        )}

        {props.allowNull && (
          <SelectGroup>
            <SelectItem value="null-sentinel" className="rounded-lg">
              <div className="flex items-center gap-2">
                <TeamIcon team="personal" />
                <span className="max-w-[140px] truncate text-sm font-semibold text-foreground/90">{props.nullLabel || 'Personal Account'}</span>
              </div>
            </SelectItem>
          </SelectGroup>
        )}

        {teams.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-1.5 mt-1 border-t border-black/[0.04] dark:border-white/[0.04]">Other Teams</SelectLabel>
            {teams
              .filter(team => team.id !== selectedTeam?.id)
              .map(team => (
                <SelectItem value={team.id} key={team.id} className="rounded-lg">
                  <div className="flex items-center gap-2">
                    <TeamIcon team={team} />
                    <span className="max-w-[140px] truncate text-sm font-semibold text-foreground/90">{team.displayName}</span>
                  </div>
                </SelectItem>
              ))}
          </SelectGroup>
        )}

        {project.config.clientTeamCreationEnabled && (
          <>
            <SelectSeparator className="bg-black/[0.04] dark:bg-white/[0.04]" />
            <div className="p-1">
              <Button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  setAccountSettingsHash("#team-creation");
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="w-full text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800/60 rounded-lg justify-start py-1.5 px-2 h-auto text-left gap-1.5"
                variant="ghost"
              >
                <Plus className="h-3.5 w-3.5" /> Create a team
              </Button>
            </div>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
