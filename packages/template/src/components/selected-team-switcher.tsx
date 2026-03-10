'use client';
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Skeleton,
} from "@stackframe/stack-ui";
import { Suspense, useEffect } from "react";
import { Team, useStackApp, useUser } from "..";
import { TeamSwitcher } from "./team-switcher";

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
  triggerClassName?: string,
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

  const navigate = app.useNavigate();

  useEffect(() => {
    if (!props.noUpdateSelectedTeam && props.selectedTeam && !props.mockUser) {
      runAsynchronouslyWithAlert(user?.setSelectedTeam(props.selectedTeam));
    }
  }, [props.noUpdateSelectedTeam, props.selectedTeam, props.mockUser]);

  return (
    <TeamSwitcher
      team={props.selectedTeam}
      allowNull={props.allowNull}
      nullLabel={props.nullLabel}
      triggerClassName={props.triggerClassName}
      onChange={async (team) => {
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
      }}
    />
  );
}
