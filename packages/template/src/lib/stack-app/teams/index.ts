import { TeamsCrud } from "@stackframe/stack-shared/dist/interface/crud/teams";
import { ReadonlyJson } from "@stackframe/stack-shared/dist/utils/json";

import { ApiKeyCreationOptions, TeamApiKey, TeamApiKeyFirstView } from "../api-keys";
import { AsyncStoreProperty } from "../common";
import { Customer } from "../customers";
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
  /** The unique identifier for this team. */
  id: string,
  /** The display name of the team. */
  displayName: string,
  /** URL of the team's profile image, or null if not set. */
  profileImageUrl: string | null,
  /** Custom metadata that can be read and written by the client. */
  clientMetadata: any,
  /** Custom metadata that can only be read by the client (set via server). */
  clientReadOnlyMetadata: any,
  /** Invites a user to join the team by email. */
  inviteUser(options: { email: string, callbackUrl?: string }): Promise<void>,
  /** Lists all users who are members of this team. */
  listUsers(): Promise<TeamUser[]>,
  /** React hook to get all users who are members of this team. */
  useUsers(): TeamUser[], // THIS_LINE_PLATFORM react-like
  /** Lists all pending invitations for this team. */
  listInvitations(): Promise<TeamInvitation[]>,
  /** React hook to get all pending invitations for this team. */
  useInvitations(): TeamInvitation[], // THIS_LINE_PLATFORM react-like
  /** Updates the team's properties. */
  update(update: TeamUpdateOptions): Promise<void>,
  /** Deletes the team. */
  delete(): Promise<void>,
  /** Creates a new API key for this team. */
  createApiKey(options: ApiKeyCreationOptions<"team">): Promise<TeamApiKeyFirstView>,
} & AsyncStoreProperty<"apiKeys", [], TeamApiKey[], true> & Customer;

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
  includeAnonymous?: boolean,
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
