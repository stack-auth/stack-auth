'use client';
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Typography
} from "@stackframe/stack-ui";
import { PlusCircle, Settings } from "lucide-react";
import { Suspense, useEffect, useMemo } from "react";
import { Team, useStackApp, useUser } from "..";
import { useTranslation } from "../lib/translations";
import { TeamIcon } from "./team-icon";

type SelectedTeamSwitcherProps = {
  urlMap?: (team: Team) => string,
  selectedTeam?: Team,
  noUpdateSelectedTeam?: boolean,
};

export function SelectedTeamSwitcher(props: SelectedTeamSwitcherProps) {
  return <Suspense fallback={<Fallback />}>
    <Inner {...props} />
  </Suspense>;
}

function Fallback() {
  return <Skeleton className="h-9 w-full max-w-64 stack-scope" />;
}

function Inner(props: SelectedTeamSwitcherProps) {
  const { t } = useTranslation();
  const app = useStackApp();
  const user = useUser();
  const project = app.useProject();
  const navigate = app.useNavigate();
  const selectedTeam = user?.selectedTeam || props.selectedTeam;
  const rawTeams = user?.useTeams();
  const teams = useMemo(() => rawTeams?.sort((a, b) => b.id === selectedTeam?.id ? 1 : -1), [rawTeams, selectedTeam]);

  useEffect(() => {
    if (!props.noUpdateSelectedTeam && props.selectedTeam) {
      runAsynchronouslyWithAlert(user?.setSelectedTeam(props.selectedTeam));
    }
  }, [props.noUpdateSelectedTeam, props.selectedTeam]);

  return (
    <Select
      value={selectedTeam?.id}
      onValueChange={(value) => {
        runAsynchronouslyWithAlert(async () => {
          const team = teams?.find(team => team.id === value);
          if (!team) {
            throw new Error('Team not found, this should not happen');
          }

          if (!props.noUpdateSelectedTeam) {
            await user?.setSelectedTeam(team);
          }
          if (props.urlMap) {
            navigate(props.urlMap(team));
          }
        });
      }}
    >
      <SelectTrigger className="stack-scope max-w-64">
        <SelectValue placeholder="Select team"/>
      </SelectTrigger>
      <SelectContent className="stack-scope">
        {user?.selectedTeam ? <SelectGroup>
          <SelectLabel>
            <div className="flex items-center justify-between">
              <span>
                {t('Current team')}
              </span>
              <Button variant='ghost' size='icon' className="h-6 w-6" onClick={() => navigate(`${app.urls.accountSettings}#team-${user.selectedTeam?.id}`)}>
                <Settings className="h-4 w-4"/>
              </Button>
            </div>
          </SelectLabel>
          <SelectItem value={user.selectedTeam.id}>
            <div className="flex items-center gap-2">
              <TeamIcon team={user.selectedTeam} />
              <Typography className="max-w-40 truncate">{user.selectedTeam.displayName}</Typography>
            </div>
          </SelectItem>
        </SelectGroup> : undefined}

        {teams?.length ?
          <SelectGroup>
            <SelectLabel>{t('Other teams')}</SelectLabel>
            {teams.filter(team => team.id !== user?.selectedTeam?.id)
              .map(team => (
                <SelectItem value={team.id} key={team.id}>
                  <div className="flex items-center gap-2">
                    <TeamIcon team={team} />
                    <Typography className="max-w-64 truncate">{team.displayName}</Typography>
                  </div>
                </SelectItem>
              ))}
          </SelectGroup> :
          <SelectGroup>
            <SelectLabel>{t('No teams yet')}</SelectLabel>
          </SelectGroup>}

        {project.config.clientTeamCreationEnabled && <>
          <SelectSeparator/>
          <div>
            <Button
              onClick={() => navigate(`${app.urls.accountSettings}#team-creation`)}
              className="w-full"
              variant='ghost'
            >
              <PlusCircle className="mr-2 h-4 w-4"/> {t('Create a team')}
            </Button>
          </div>
        </>}
      </SelectContent>
    </Select>
  );
}
