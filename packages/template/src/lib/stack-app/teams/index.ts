import { TeamsCrud } from "@stackframe/stack-shared/dist/interface/crud/teams";
import { ReadonlyJson } from "@stackframe/stack-shared/dist/utils/json";

import { ApiKeyCreationOptions, TeamApiKey, TeamApiKeyFirstView } from "../api-keys";
import { AsyncStoreProperty } from "../common";
import { ServerUser } from "../users";


export type TeamMemberProfile = {
  displayName: string | null,
  profileImageUrl: string | null,
}

export type TeamMemberProfileUpdateOptions = {
  displayName?: string,
  profileImageUrl?: string | null,
};

export type EditableTeamMemberProfile = TeamMemberProfile & {
  update(update: TeamMemberProfileUpdateOptions): Promise<void>,
}

export type TeamUser = {
  id: string,
  teamProfile: TeamMemberProfile,
}

export type TeamInvitation = {
  id: string,
  recipientEmail: string | null,
  expiresAt: Date,
  revoke(): Promise<void>,
}

export type Team = {
  id: string,
  displayName: string,
  profileImageUrl: string | null,
  clientMetadata: any,
  clientReadOnlyMetadata: any,
  inviteUser(options: { email: string, callbackUrl?: string }): Promise<void>,
  listUsers(): Promise<TeamUser[]>,
  useUsers(): TeamUser[], // THIS_LINE_PLATFORM react-like
  listInvitations(): Promise<TeamInvitation[]>,
  useInvitations(): TeamInvitation[], // THIS_LINE_PLATFORM react-like
  update(update: TeamUpdateOptions): Promise<void>,
  delete(): Promise<void>,
  createApiKey(options: ApiKeyCreationOptions<"team">): Promise<TeamApiKeyFirstView>,
} & AsyncStoreProperty<"apiKeys", [], TeamApiKey[], true>;

export type TeamUpdateOptions = {
  displayName?: string,
  profileImageUrl?: string | null,
  clientMetadata?: ReadonlyJson,
};
export function teamUpdateOptionsToCrud(options: TeamUpdateOptions): TeamsCrud["Client"]["Update"] {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata,
  };
}

export type TeamCreateOptions = {
  displayName: string,
  profileImageUrl?: string,
}
export function teamCreateOptionsToCrud(options: TeamCreateOptions, creatorUserId: string): TeamsCrud["Client"]["Create"] {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    creator_user_id: creatorUserId,
  };
}


export type ServerTeamMemberProfile = TeamMemberProfile;

export type ServerTeamUser = ServerUser & {
  teamProfile: ServerTeamMemberProfile,
}

export type ServerTeam = {
  createdAt: Date,
  serverMetadata: any,
  listUsers(): Promise<ServerTeamUser[]>,
  useUsers(): ServerUser[], // THIS_LINE_PLATFORM react-like
  update(update: ServerTeamUpdateOptions): Promise<void>,
  delete(): Promise<void>,
  addUser(userId: string): Promise<void>,
  inviteUser(options: { email: string, callbackUrl?: string }): Promise<void>,
  removeUser(userId: string): Promise<void>,
} & Team;

export type ServerListUsersOptions = {
  cursor?: string,
  limit?: number,
  orderBy?: 'signedUpAt',
  desc?: boolean,
  query?: string,
};

export type ServerTeamCreateOptions = TeamCreateOptions & {
  creatorUserId?: string,
};
export function serverTeamCreateOptionsToCrud(options: ServerTeamCreateOptions): TeamsCrud["Server"]["Create"] {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    creator_user_id: options.creatorUserId,
  };
}

export type ServerTeamUpdateOptions = TeamUpdateOptions & {
  clientReadOnlyMetadata?: ReadonlyJson,
  serverMetadata?: ReadonlyJson,
};
export function serverTeamUpdateOptionsToCrud(options: ServerTeamUpdateOptions): TeamsCrud["Server"]["Update"] {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
  };
}
