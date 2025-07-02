'use client';
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
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

type MockTeam = {
  id: string,
  displayName: string,
  profileImageUrl?: string | null,
};

type SelectedTeamSwitcherProps<AllowNull extends boolean = false> = {
  urlMap?: (team: AllowNull extends true ? Team | null : Team) => string,
  selectedTeam?: Team,
  noUpdateSelectedTeam?: boolean,
  allowNull?: AllowNull,
  nullLabel?: string,
  onChange?: (team: AllowNull extends true ? Team | null : Team) => void,
  // Mock data props
  mockUser?: {
    selectedTeam?: MockTeam,
  },
  mockTeams?: MockTeam[],
  mockProject?: {
    config: {
      clientTeamCreationEnabled: boolean,
    },
  },
};

export function SelectedTeamSwitcher<AllowNull extends boolean = false>(props: SelectedTeamSwitcherProps<AllowNull>) {
  return <Suspense fallback={<Fallback />}>
    <Inner {...props} />
  </Suspense>;
}

function Fallback() {
  return <Skeleton className="h-9 w-full max-w-64 stack-scope" />;
}

function Inner<AllowNull extends boolean>(props: SelectedTeamSwitcherProps<AllowNull>) {
  const { t } = useTranslation();
  const appFromHook = useStackApp();
  const userFromHook = useUser();

  // Use mock data if provided, otherwise use real data
  const app = props.mockUser ? {
    useProject: () => props.mockProject || { config: { clientTeamCreationEnabled: false } },
    useNavigate: () => () => {}, // Mock navigate function
    urls: { accountSettings: '/account-settings' },
  } : appFromHook;

  const user = props.mockUser ? {
    selectedTeam: props.mockUser.selectedTeam,
    useTeams: () => props.mockTeams || [],
    setSelectedTeam: async () => {}, // Mock function
  } : userFromHook;

  const project = app.useProject();
  const navigate = app.useNavigate();
  const selectedTeam = user?.selectedTeam || props.selectedTeam;
  const rawTeams = user?.useTeams();
  const teams = useMemo(() => rawTeams?.sort((a, b) => b.id === selectedTeam?.id ? 1 : -1), [rawTeams, selectedTeam]);

  useEffect(() => {
    if (!props.noUpdateSelectedTeam && props.selectedTeam && !props.mockUser) {
      runAsynchronouslyWithAlert(user?.setSelectedTeam(props.selectedTeam));
    }
  }, [props.noUpdateSelectedTeam, props.selectedTeam, props.mockUser]);

  return (
    <Select
      value={selectedTeam?.id || (props.allowNull ? 'null-sentinel' : undefined)}
      onValueChange={(value) => {
        runAsynchronouslyWithAlert(async () => {
          let team: MockTeam | null = null;
          if (value !== 'null-sentinel') {
            team = teams?.find(team => team.id === value) || null;
            if (!team) {
              throw new StackAssertionError('Team not found, this should not happen');
            }
          } else {
            team = null;
          }

          // Call onChange callback if provided
          if (props.onChange) {
            props.onChange(team as Team);
          }

          // Skip actual navigation/updates in mock mode
          if (props.mockUser) return;

          if (!props.noUpdateSelectedTeam) {
            await user?.setSelectedTeam(team as Team);
          }
          if (props.urlMap) {
            navigate(props.urlMap(team as Team));
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
              <Button
                variant='ghost'
                size='icon'
                className="h-6 w-6"
                onClick={() => {
                  // Skip navigation in mock mode
                  if (!props.mockUser) {
                    navigate(`${app.urls.accountSettings}#team-${user.selectedTeam?.id}`);
                  }
                }}
              >
                <Settings className="h-4 w-4"/>
              </Button>
            </div>
          </SelectLabel>
          <SelectItem value={user.selectedTeam.id}>
            <div className="flex items-center gap-2">
              <TeamIcon team={user.selectedTeam as Team} />
              <Typography className="max-w-40 truncate">{user.selectedTeam.displayName}</Typography>
            </div>
          </SelectItem>
        </SelectGroup> : undefined}

        {props.allowNull && <SelectGroup>
          <SelectItem value="null-sentinel">
            <div className="flex items-center gap-2">
              <TeamIcon team='personal' />
              <Typography className="max-w-40 truncate">{props.nullLabel || t('No team')}</Typography>
            </div>
          </SelectItem>
        </SelectGroup>}

        {teams?.length ?
          <SelectGroup>
            <SelectLabel>{t('Other teams')}</SelectLabel>
            {teams.filter(team => team.id !== user?.selectedTeam?.id)
              .map(team => (
                <SelectItem value={team.id} key={team.id}>
                  <div className="flex items-center gap-2">
                    <TeamIcon team={team as Team} />
                    <Typography className="max-w-64 truncate">{team.displayName}</Typography>
                  </div>
                </SelectItem>
              ))}
          </SelectGroup> : null}

        {!teams?.length && !props.allowNull ?
          <SelectGroup>
            <SelectLabel>{t('No teams yet')}</SelectLabel>
          </SelectGroup> : null}

        {project.config.clientTeamCreationEnabled && <>
          <SelectSeparator/>
          <div>
            <Button
              onClick={() => {
                // Skip navigation in mock mode
                if (!props.mockUser) {
                  navigate(`${app.urls.accountSettings}#team-creation`);
                }
              }}
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
