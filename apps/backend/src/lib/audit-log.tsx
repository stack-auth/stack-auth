import { globalPrismaClient } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { Prisma } from "@/generated/prisma/client";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";

export const AUDIT_LOG_ACTIONS = [
  "impersonation.started",
  "impersonation.revoked",
  "project_settings.updated",
  "user.created",
  "user.deleted",
  "user.updated",
  "user.restricted",
  "user.unrestricted",
  "user.password.set",
  "user.mfa.removed",
  "user.password_reset.sent",
  "user.sign_in_invitation.sent",
  "contact_channel.created",
  "contact_channel.updated",
  "contact_channel.deleted",
  "contact_channel.verification.sent",
  "project_api_key.created",
  "project_api_key.updated",
  "project_api_key.revoked",
] as const;

export type AuditLogAction = typeof AUDIT_LOG_ACTIONS[number];

export const AUDIT_LOG_ACTOR_TYPES = [
  "admin_user",
  "server_key",
  "unknown",
] as const;

export type AuditLogActorType = typeof AUDIT_LOG_ACTOR_TYPES[number];

export type AuditLogActor = {
  type: AuditLogActorType,
  userId: string | null,
  label: string,
};

// Used when an event has an actor but no separate *target* customer user
// (e.g. project settings). Impersonation sets a real targetUserId; settings does not.
// Sentinel avoids SQL NULL for older Prisma clients that still require the column.
// The list API maps this back to null for the UI.
export const AUDIT_LOG_NO_TARGET_USER_ID = "00000000-0000-0000-0000-000000000000";

// Intentionally narrower than SmartRequestAuth: route handlers only declare the
// auth fields they need in yup schemas, so callers pass a partial auth object.
export type AuditActorSource = {
  type: "client" | "server" | "admin",
  adminUser?: {
    id: string,
    display_name: string | null,
    primary_email: string | null,
  } | null | undefined,
  /**
   * Set by createCrudHandlers' programmatic admin/server/client helpers
   * (adminUpdate, serverCreate, etc.). Those synthesize auth.type from the
   * helper name (often "admin") even for signup / self-service /
   * password-reset internals — never treat them as dashboard/admin audit
   * actors. HTTP route handlers leave this unset.
   */
  isProgrammaticInvocation?: boolean,
};

/** Admin audit trail covers dashboard/admin + server-key HTTP mutations, not client self-service or internal programmatic CRUD. */
export function shouldRecordAdminAudit(auth: AuditActorSource): boolean {
  if (auth.isProgrammaticInvocation === true) {
    return false;
  }
  return auth.type === "admin" || auth.type === "server";
}

const MAX_CHANGED_PATHS = 100;
const MAX_AUDIT_VALUE_STRING_LENGTH = 500;

// Leaf path segments that typically hold secrets. Parent namespaces like
// `auth.password.allowSignIn` are fine — only the leaf is checked.
const SENSITIVE_LEAF_SEGMENTS = new Set([
  "password",
  "clientsecret",
  "client_secret",
  "secret",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "appleprivatekey",
  "apple_private_key",
  "connectionstring",
  "connection_string",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "webhooksecret",
  "webhook_secret",
  "authorization",
  "credentials",
  "credential",
]);

export type AuditFieldChange = {
  before: Prisma.JsonValue,
  after: Prisma.JsonValue,
};

/**
 * True when the path's leaf (or known secret-bearing prefixes) should never
 * have values persisted — path keys are still recorded in changed_paths.
 */
export function isAuditLogPathSensitive(path: string): boolean {
  const normalized = path.toLowerCase();
  if (
    normalized.includes("dbsync.externaldatabases")
    || normalized.includes("sourceoftruth.connectionstring")
  ) {
    return true;
  }
  const segments = normalized.split(".");
  const leaf = segments[segments.length - 1] ?? "";
  return SENSITIVE_LEAF_SEGMENTS.has(leaf);
}

export function resolveAuditActor(auth: AuditActorSource): AuditLogActor {
  if (auth.adminUser != null) {
    const label = auth.adminUser.display_name?.trim()
      || auth.adminUser.primary_email?.trim()
      || auth.adminUser.id;
    return {
      type: "admin_user",
      userId: auth.adminUser.id,
      label,
    };
  }
  if (auth.type === "server") {
    return {
      type: "server_key",
      userId: null,
      label: "Server API key",
    };
  }
  if (auth.type === "admin") {
    return {
      type: "unknown",
      userId: null,
      label: "Admin API key",
    };
  }
  return {
    type: "unknown",
    userId: null,
    label: "Unknown",
  };
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const trimmed = reason.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Collect leaf config/update paths for audit metadata.
 * Supports both dotted path-notation objects and nested objects.
 */
export function collectConfigPaths(value: unknown, prefix = ""): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return prefix === "" ? [] : [prefix];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return prefix === "" ? [] : [prefix];
  }
  const paths: string[] = [];
  for (const [key, child] of entries) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (child != null && typeof child === "object" && !Array.isArray(child)) {
      const nested = collectConfigPaths(child, path);
      if (nested.length === 0) {
        paths.push(path);
      } else {
        paths.push(...nested);
      }
    } else {
      paths.push(path);
    }
  }
  return paths;
}

export function limitChangedPaths(paths: string[]): { changed_paths: string[], changed_paths_truncated: boolean } {
  if (paths.length <= MAX_CHANGED_PATHS) {
    return { changed_paths: paths, changed_paths_truncated: false };
  }
  return {
    changed_paths: paths.slice(0, MAX_CHANGED_PATHS),
    changed_paths_truncated: true,
  };
}

/**
 * Resolve a dotted path against nested objects and/or path-notation keys
 * (e.g. `{ "auth.password.allowSignIn": true }` or `{ "emails.server": { host: "…" } }`).
 */
export function getValueAtDottedPath(root: unknown, path: string): unknown {
  if (path === "") return root;
  if (root == null || typeof root !== "object" || Array.isArray(root)) {
    return undefined;
  }
  const record = root as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, path)) {
    return record[path];
  }
  const segments = path.split(".");
  // Prefer longest matching path-notation key prefix (emails.server before emails).
  for (let end = segments.length - 1; end >= 1; end--) {
    const head = segments.slice(0, end).join(".");
    if (Object.prototype.hasOwnProperty.call(record, head)) {
      return getValueAtDottedPath(record[head], segments.slice(end).join("."));
    }
  }
  const first = segments[0] ?? throwErr(`Unexpected empty path segment while resolving audit log path ${JSON.stringify(path)}`);
  if (!Object.prototype.hasOwnProperty.call(record, first)) {
    return undefined;
  }
  return getValueAtDottedPath(record[first], segments.slice(1).join("."));
}

function looksLikeSecretString(value: string): boolean {
  // Connection strings / URLs with embedded credentials.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i.test(value)) {
    return true;
  }
  return false;
}

function normalizeAuditJsonValue(value: unknown): Prisma.JsonValue | undefined {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (looksLikeSecretString(value)) {
      return undefined;
    }
    if (value.length > MAX_AUDIT_VALUE_STRING_LENGTH) {
      return `${value.slice(0, MAX_AUDIT_VALUE_STRING_LENGTH)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items: Prisma.JsonValue[] = [];
    for (const item of value) {
      if (item === null || typeof item === "boolean" || typeof item === "number") {
        items.push(item);
        continue;
      }
      if (typeof item === "string") {
        if (looksLikeSecretString(item)) {
          return undefined;
        }
        items.push(
          item.length > MAX_AUDIT_VALUE_STRING_LENGTH
            ? `${item.slice(0, MAX_AUDIT_VALUE_STRING_LENGTH)}…`
            : item,
        );
        continue;
      }
      // Nested objects/arrays in a leaf value — too unstructured to log safely.
      return undefined;
    }
    return items;
  }
  return undefined;
}

/**
 * Build before/after value map for non-sensitive paths only.
 * Sensitive paths stay in changed_paths but are omitted here.
 */
export function buildNonSensitiveFieldChanges(options: {
  paths: string[],
  beforeRoot: unknown,
  afterRoot: unknown,
}): Record<string, AuditFieldChange> {
  const changes: Record<string, AuditFieldChange> = {};
  for (const path of options.paths) {
    if (isAuditLogPathSensitive(path)) {
      continue;
    }
    const beforeNormalized = normalizeAuditJsonValue(getValueAtDottedPath(options.beforeRoot, path));
    const afterNormalized = normalizeAuditJsonValue(getValueAtDottedPath(options.afterRoot, path));
    // If either side looks secret / non-auditable, skip values for this path.
    if (beforeNormalized === undefined || afterNormalized === undefined) {
      continue;
    }
    changes[path] = {
      before: beforeNormalized,
      after: afterNormalized,
    };
  }
  return changes;
}

/**
 * Always-on admin audit write — the single integration point for new call sites.
 *
 * Pass `auth` (not a pre-built actor); actor resolution is handled here.
 * Insert failures fail the caller so audited actions cannot succeed without a
 * durable trail. Viewing is gated by the Compliance app; writes are not.
 *
 * For settings diffs, use `buildProjectSettingsAuditMetadata` then pass the
 * result as `metadata` — don't invent per-action wrappers for simple events.
 */
export async function recordAuditEvent(options: {
  tenancy: Tenancy,
  auth: AuditActorSource,
  action: AuditLogAction,
  targetUserId?: string | null,
  reason?: string | null,
  metadata?: Record<string, unknown> | null,
}): Promise<void> {
  const actor = resolveAuditActor(options.auth);
  const reason = normalizeReason(options.reason);

  try {
    await globalPrismaClient.auditLogEvent.create({
      data: {
        tenancyId: options.tenancy.id,
        action: options.action,
        actorType: actor.type,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        targetUserId: options.targetUserId ?? AUDIT_LOG_NO_TARGET_USER_ID,
        reason,
        metadata: options.metadata == null
          ? undefined
          : (options.metadata as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    throw new HexclaveAssertionError(
      "Failed to write admin audit log event; refusing to continue the audited action.",
      { cause: error },
    );
  }
}

/**
 * Build metadata for project_settings.updated (path list + non-sensitive
 * before/after). Returns null when there is nothing to report.
 */
export function buildProjectSettingsAuditMetadata(options: {
  source: string,
  writeMode: "merge" | "replace",
  changedPaths: string[],
  beforeRoot: unknown,
  afterRoot: unknown,
  level?: "project" | "branch" | "environment",
}): Record<string, unknown> | null {
  if (options.changedPaths.length === 0) {
    return null;
  }
  const { changed_paths, changed_paths_truncated } = limitChangedPaths(options.changedPaths);
  const changes = buildNonSensitiveFieldChanges({
    paths: changed_paths,
    beforeRoot: options.beforeRoot,
    afterRoot: options.afterRoot,
  });
  return {
    source: options.source,
    write_mode: options.writeMode,
    ...(options.level != null ? { level: options.level } : {}),
    changed_paths,
    ...(changed_paths_truncated ? { changed_paths_truncated: true } : {}),
    ...(Object.keys(changes).length > 0 ? { changes } : {}),
  };
}

/**
 * Metadata for resource creates: changed_paths + after values (before is null).
 * Secrets stay path-only. Shape matches what the Compliance details column renders.
 */
export function buildCreatedFieldsAuditMetadata(options: {
  source: string,
  fields: Record<string, unknown>,
}): Record<string, unknown> | null {
  const afterRoot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options.fields)) {
    // Skip omitted and explicit-null creates (dashboard often posts null for
    // unused metadata). Logging `+ null` just noise in the audit UI.
    if (value !== undefined && value !== null) {
      afterRoot[key] = value;
    }
  }
  const changedPaths = collectConfigPaths(afterRoot);
  if (changedPaths.length === 0) {
    return null;
  }
  const { changed_paths, changed_paths_truncated } = limitChangedPaths(changedPaths);
  // Empty beforeRoot → normalizeAuditJsonValue(undefined) → null, so UI shows
  // green "+ value" rows for each non-sensitive leaf.
  const changes = buildNonSensitiveFieldChanges({
    paths: changed_paths,
    beforeRoot: {},
    afterRoot,
  });
  return {
    source: options.source,
    changed_paths,
    ...(changed_paths_truncated ? { changed_paths_truncated: true } : {}),
    ...(Object.keys(changes).length > 0 ? { changes } : {}),
  };
}

/**
 * Metadata for resource updates: leaf paths from the patch + before/after from
 * full snapshots. Secrets stay path-only (same as settings / creates).
 */
export function buildUpdatedFieldsAuditMetadata(options: {
  source: string,
  patch: Record<string, unknown>,
  beforeRoot: unknown,
  afterRoot: unknown,
}): Record<string, unknown> | null {
  const changedPaths = collectConfigPaths(options.patch);
  if (changedPaths.length === 0) {
    return null;
  }
  const { changed_paths, changed_paths_truncated } = limitChangedPaths(changedPaths);
  const changes = buildNonSensitiveFieldChanges({
    paths: changed_paths,
    beforeRoot: options.beforeRoot,
    afterRoot: options.afterRoot,
  });
  return {
    source: options.source,
    changed_paths,
    ...(changed_paths_truncated ? { changed_paths_truncated: true } : {}),
    ...(Object.keys(changes).length > 0 ? { changes } : {}),
  };
}
