export {
  HexclaveAdminApp,
  HexclaveClientApp,
  HexclaveServerApp,
} from "./apps";

// Legacy Stack* aliases — same runtime symbols, kept for backwards compatibility.
// Prefer the Hexclave* equivalents in new code. See RENAME-TO-HEXCLAVE.md (Tier 1).
/** @deprecated Use `HexclaveAdminApp` instead — same symbol, new brand name. */
export { StackAdminApp } from "./apps";
/** @deprecated Use `HexclaveClientApp` instead — same symbol, new brand name. */
export { StackClientApp } from "./apps";
/** @deprecated Use `HexclaveServerApp` instead — same symbol, new brand name. */
export { StackServerApp } from "./apps";

// HexclaveAdminApp / HexclaveClientApp / HexclaveServerApp are already exported above as values
// (which TypeScript treats as both value and type). Only the constructor / options / JSON
// helper types need separate type-only re-exports.
export type {
  HexclaveAdminAppConstructor,
  HexclaveAdminAppConstructorOptions,
  HexclaveClientAppConstructor,
  HexclaveClientAppConstructorOptions,
  HexclaveClientAppJson,
  HexclaveServerAppConstructor,
  HexclaveServerAppConstructorOptions,
} from "./apps";

/** @deprecated Use `HexclaveAdminAppConstructor` instead — same symbol, new brand name. */
export type { StackAdminAppConstructor } from "./apps";
/** @deprecated Use `HexclaveAdminAppConstructorOptions` instead — same symbol, new brand name. */
export type { StackAdminAppConstructorOptions } from "./apps";
/** @deprecated Use `HexclaveClientAppConstructor` instead — same symbol, new brand name. */
export type { StackClientAppConstructor } from "./apps";
/** @deprecated Use `HexclaveClientAppConstructorOptions` instead — same symbol, new brand name. */
export type { StackClientAppConstructorOptions } from "./apps";
/** @deprecated Use `HexclaveClientAppJson` instead — same symbol, new brand name. */
export type { StackClientAppJson } from "./apps";
/** @deprecated Use `HexclaveServerAppConstructor` instead — same symbol, new brand name. */
export type { StackServerAppConstructor } from "./apps";
/** @deprecated Use `HexclaveServerAppConstructorOptions` instead — same symbol, new brand name. */
export type { StackServerAppConstructorOptions } from "./apps";

export type {
  EmailOutboxListOptions,
  EmailOutboxListResult,
  EmailOutboxUpdateOptions
} from "./apps/interfaces/admin-app";

export type {
  ProjectConfig
} from "./project-configs";

export type {
  InternalApiKey,
  InternalApiKeyBase,
  InternalApiKeyBaseCrudRead,
  InternalApiKeyCreateOptions,
  InternalApiKeyFirstView
} from "./internal-api-keys";

export {
  stackAppInternalsSymbol,
} from "./common";
export {
  getPagePrompt,
} from "./url-targets";
export type {
  GetCurrentUserOptions,
  /** @deprecated Use GetCurrentUserOptions instead */
  GetCurrentUserOptions as GetUserOptions,
  HandlerUrlOptions,
  HandlerUrls, OAuthScopesOnSignIn, ResolvedHandlerUrls
} from "./common";

export type {
  Connection,
  OAuthConnection
} from "./connected-accounts";

export type {
  ContactChannel,
  ServerContactChannel
} from "./contact-channels";

export type {
  AdminEmailOutbox,
  AdminEmailOutboxRecipient,
  AdminEmailOutboxSimpleStatus,
  AdminEmailOutboxStatus,
  AdminSendAttemptError,
  AdminSentEmail
} from "./email";

export type {
  AdminProjectPermission,
  AdminProjectPermissionDefinition,
  AdminProjectPermissionDefinitionCreateOptions,
  AdminProjectPermissionDefinitionUpdateOptions, AdminTeamPermission,
  AdminTeamPermissionDefinition,
  AdminTeamPermissionDefinitionCreateOptions,
  AdminTeamPermissionDefinitionUpdateOptions
} from "./permissions";

export type {
  AdminDomainConfig,
  AdminEmailConfig,
  AdminOAuthProviderConfig,
  AdminProjectConfig,
  AdminProjectConfigUpdateOptions,
  OAuthProviderConfig
} from "./project-configs";

export type {
  AdminOwnedProject,
  AdminProject,
  AdminProjectCreateOptions,
  AdminProjectUpdateOptions,
  Project,
  PushedConfigSource
} from "./projects";

export type {
  EditableTeamMemberProfile, ReceivedTeamInvitation,
  SentTeamInvitation, ServerListUsersOptions,
  ServerTeam,
  ServerTeamCreateOptions, ServerTeamMemberProfile,
  ServerTeamUpdateOptions,
  ServerTeamUser,
  Team,
  TeamCreateOptions,
  TeamInvitation,
  TeamMemberProfile,
  TeamUpdateOptions,
  TeamUser
} from "./teams";

export type {
  Auth,
  CurrentInternalServerUser,
  CurrentInternalUser,
  CurrentServerUser,
  CurrentUser,
  OAuthProvider,
  ServerOAuthProvider,
  ServerUser,
  User
} from "./users";
