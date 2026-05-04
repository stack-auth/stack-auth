import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import type { BetterAuthPersistenceAdapter, BetterAuthPersistenceRecord, BetterAuthWhere, ExternalAuthSnapshot, ExternalMembership, ExternalOAuthAccount, ExternalOrganization, ExternalRestriction, ExternalUser, JsonObject, JsonValue, StackImportOptions, StackMigrationPlan } from "./types";
import { buildStackMigrationPlan } from "./stack-plan";

export type BetterAuthStackPersistence = {
  adapter: BetterAuthPersistenceAdapter,
  snapshot(): ExternalAuthSnapshot,
  buildPlan(options?: StackImportOptions): StackMigrationPlan,
};

function assertString(value: JsonValue | undefined, field: string, model: string): string {
  if (typeof value !== "string") {
    throw new StackAssertionError(`Better Auth ${model}.${field} must be a string during Stack Auth migration`, { value });
  }
  return value;
}

function optionalString(value: JsonValue | undefined, field: string, model: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new StackAssertionError(`Better Auth ${model}.${field} must be a string during Stack Auth migration`, { value });
  }
  return value;
}

function optionalBoolean(value: JsonValue | undefined, field: string, model: string): boolean {
  if (value == null) return false;
  if (typeof value !== "boolean") {
    throw new StackAssertionError(`Better Auth ${model}.${field} must be a boolean during Stack Auth migration`, { value });
  }
  return value;
}

function toJsonObject(value: JsonValue | undefined, field: string, model: string): JsonObject {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new StackAssertionError(`Better Auth ${model}.${field} must be an object during Stack Auth migration`, { value });
}

function createdUpdatedMetadata(record: BetterAuthPersistenceRecord): JsonObject {
  return {
    better_auth: {
      id: record.id,
      created_at: optionalString(record.createdAt, "createdAt", "record"),
      updated_at: optionalString(record.updatedAt, "updatedAt", "record"),
    },
  };
}

function matchesWhere(record: BetterAuthPersistenceRecord, where: BetterAuthWhere | undefined): boolean {
  if (where == null || where.length === 0) return true;
  return where.every((clause) => {
    const recordValue = record[clause.field];
    switch (clause.operator ?? "eq") {
      case "eq": {
        return recordValue === clause.value;
      }
      case "ne": {
        return recordValue !== clause.value;
      }
      case "in": {
        return Array.isArray(clause.value) && clause.value.includes(recordValue);
      }
      case "contains": {
        return typeof recordValue === "string" && typeof clause.value === "string" && recordValue.includes(clause.value);
      }
      case "starts_with": {
        return typeof recordValue === "string" && typeof clause.value === "string" && recordValue.startsWith(clause.value);
      }
      case "ends_with": {
        return typeof recordValue === "string" && typeof clause.value === "string" && recordValue.endsWith(clause.value);
      }
      default: {
        throw new StackAssertionError(`Unsupported Better Auth where operator ${String(clause.operator)}`, { clause });
      }
    }
  });
}

function cloneRecord(record: BetterAuthPersistenceRecord): BetterAuthPersistenceRecord {
  return JSON.parse(JSON.stringify(record)) as BetterAuthPersistenceRecord;
}

function pushRecord(table: Map<string, BetterAuthPersistenceRecord>, model: string, data: JsonObject): BetterAuthPersistenceRecord {
  const id = assertString(data.id, "id", model);
  if (table.has(id)) {
    throw new StackAssertionError(`Better Auth ${model} record ${id} was created twice during Stack Auth migration`);
  }
  const record = { ...data, id };
  table.set(id, record);
  return cloneRecord(record);
}

function collectOAuthAccounts(accounts: BetterAuthPersistenceRecord[], userId: string, email: string | null): ExternalOAuthAccount[] {
  return accounts
    .filter((account) => account.userId === userId && account.providerId !== "credential")
    .map((account) => ({
      providerId: assertString(account.providerId, "providerId", "account"),
      accountId: assertString(account.accountId, "accountId", "account"),
      email,
    }));
}

function collectPasswordHash(accounts: BetterAuthPersistenceRecord[], userId: string): string | null {
  const credentialAccounts = accounts.filter((account) => account.userId === userId && account.providerId === "credential");
  if (credentialAccounts.length > 1) {
    throw new StackAssertionError(`Better Auth user ${userId} has multiple credential accounts`);
  }
  return optionalString(credentialAccounts[0]?.password, "password", "account");
}

function collectRestriction(record: BetterAuthPersistenceRecord): ExternalRestriction | null {
  if (record.banned !== true) return null;
  return {
    reason: optionalString(record.banReason, "banReason", "user") ?? "Imported as banned",
    privateDetails: `Better Auth user ${record.id} was banned during migration.`,
  };
}

export function createBetterAuthStackPersistence(): BetterAuthStackPersistence {
  const tables = new Map<string, Map<string, BetterAuthPersistenceRecord>>();

  function getTable(model: string): Map<string, BetterAuthPersistenceRecord> {
    const existing = tables.get(model);
    if (existing) return existing;
    const created = new Map<string, BetterAuthPersistenceRecord>();
    tables.set(model, created);
    return created;
  }

  const adapter: BetterAuthPersistenceAdapter = {
    async create(input) {
      return pushRecord(getTable(input.model), input.model, input.data);
    },
    async findOne(input) {
      return [...getTable(input.model).values()].find((record) => matchesWhere(record, input.where)) ?? null;
    },
    async findMany(input) {
      const offset = input.offset ?? 0;
      const limit = input.limit ?? Number.POSITIVE_INFINITY;
      return [...getTable(input.model).values()]
        .filter((record) => matchesWhere(record, input.where))
        .slice(offset, offset + limit)
        .map(cloneRecord);
    },
    async update(input) {
      const match = [...getTable(input.model).values()].find((record) => matchesWhere(record, input.where));
      if (match == null) return null;
      Object.assign(match, input.update);
      return cloneRecord(match);
    },
    async updateMany(input) {
      const matches = [...getTable(input.model).values()].filter((record) => matchesWhere(record, input.where));
      for (const match of matches) Object.assign(match, input.update);
      return matches.length;
    },
    async delete(input) {
      const table = getTable(input.model);
      const match = [...table.values()].find((record) => matchesWhere(record, input.where));
      if (match != null) table.delete(match.id);
    },
    async deleteMany(input) {
      const table = getTable(input.model);
      const matches = [...table.values()].filter((record) => matchesWhere(record, input.where));
      for (const match of matches) table.delete(match.id);
      return matches.length;
    },
    async count(input) {
      return [...getTable(input.model).values()].filter((record) => matchesWhere(record, input.where)).length;
    },
  };

  function snapshot(): ExternalAuthSnapshot {
    const usersTable = getTable("user");
    const accounts = [...getTable("account").values()];
    const organizationsTable = getTable("organization");
    const membersTable = getTable("member");

    const users: ExternalUser[] = [...usersTable.values()].map((record) => {
      const email = optionalString(record.email, "email", "user");
      return {
        externalId: record.id,
        primaryEmail: email,
        primaryEmailVerified: optionalBoolean(record.emailVerified, "emailVerified", "user"),
        displayName: optionalString(record.name, "name", "user"),
        profileImageUrl: optionalString(record.image, "image", "user"),
        passwordHash: collectPasswordHash(accounts, record.id),
        oauthAccounts: collectOAuthAccounts(accounts, record.id, email),
        restricted: collectRestriction(record),
        metadata: createdUpdatedMetadata(record),
      };
    });

    const organizations: ExternalOrganization[] = [...organizationsTable.values()].map((record) => {
      const baseMetadata = createdUpdatedMetadata(record);
      return {
        externalId: record.id,
        displayName: assertString(record.name, "name", "organization"),
        profileImageUrl: optionalString(record.logo, "logo", "organization"),
        metadata: {
          ...baseMetadata,
          better_auth: {
            ...toJsonObject(baseMetadata.better_auth, "better_auth", "organization"),
            slug: optionalString(record.slug, "slug", "organization"),
            metadata: record.metadata ?? null,
          },
        },
      };
    });

    const memberships: ExternalMembership[] = [...membersTable.values()].map((record) => ({
      externalId: record.id,
      externalUserId: assertString(record.userId, "userId", "member"),
      externalOrganizationId: assertString(record.organizationId, "organizationId", "member"),
      role: optionalString(record.role, "role", "member"),
      metadata: createdUpdatedMetadata(record),
    }));

    return { source: "better_auth", users, organizations, memberships };
  }

  return {
    adapter,
    snapshot,
    buildPlan(options?: StackImportOptions) {
      return buildStackMigrationPlan(snapshot(), options);
    },
  };
}
