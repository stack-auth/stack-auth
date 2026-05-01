export { buildStackMigrationPlan } from "./core";
export { importPlanToStackAuth } from "./stack-api";
export type { StackApiConfig, StackImportResult } from "./stack-api";
export { createBetterAuthStackPersistence } from "./adapters/better-auth";
export type { BetterAuthPersistenceAdapter, BetterAuthPersistenceRecord, BetterAuthStackPersistence } from "./adapters/better-auth";
export type {
  ExternalAuthSnapshot,
  ExternalMembership,
  ExternalOAuthAccount,
  ExternalOrganization,
  ExternalRestriction,
  ExternalUser,
  JsonObject,
  JsonValue,
  StackImportOptions,
  StackMigrationPlan,
  StackTeamCreateBody,
  StackUserCreateBody,
} from "./types";
