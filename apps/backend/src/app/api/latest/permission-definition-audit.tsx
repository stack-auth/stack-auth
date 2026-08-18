import {
  buildCreatedFieldsAuditMetadata,
  buildUpdatedFieldsAuditMetadata,
  recordAuditEvent,
  shouldRecordDashboardAudit,
  type AuditActorSource,
} from "@/lib/audit-log";
import type { Tenancy } from "@/lib/tenancies";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { typedEntries } from "@hexclave/shared/dist/utils/objects";

type PermissionDefinitionScope = "team" | "project";

type PermissionDefinitionSnapshot = {
  permission_id: string,
  description: string | null,
  contained_permission_ids: string[],
  scope: PermissionDefinitionScope,
};

function snapshotPermissionDefinitionFromConfig(
  tenancy: Tenancy,
  permissionId: string,
  scope: PermissionDefinitionScope,
): PermissionDefinitionSnapshot | null {
  const permissions = tenancy.config.rbac.permissions;
  if (!(permissionId in permissions)) {
    return null;
  }
  const definition = permissions[permissionId];
  if (definition.scope !== scope) {
    return null;
  }
  return {
    permission_id: permissionId,
    description: definition.description ?? null,
    contained_permission_ids: typedEntries(definition.containedPermissionIds)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id)
      .sort(stringCompare),
    scope,
  };
}

/**
 * RBAC definition CRUD is dashboard-only Compliance (admin access token / adminUser).
 * Bare admin/server API keys and programmatic CRUD helpers do not write these events.
 * Config override via overrideEnvironmentConfigOverride does not itself audit — this is
 * the dedicated trail for the permission-definitions routes.
 */
export async function recordPermissionDefinitionAudit(options: {
  auth: AuditActorSource & { tenancy: Tenancy },
  scope: PermissionDefinitionScope,
  action: "permission_definition.created" | "permission_definition.updated" | "permission_definition.deleted",
  source: string,
  before?: PermissionDefinitionSnapshot | null,
  after?: PermissionDefinitionSnapshot | null,
  /** Request patch for updates (paths only); ignored for create/delete. */
  patch?: Record<string, unknown>,
}): Promise<void> {
  if (!shouldRecordDashboardAudit(options.auth)) {
    return;
  }

  const { auth, action, source, scope } = options;

  if (action === "permission_definition.created") {
    const after = options.after;
    if (after == null) return;
    const metadata = buildCreatedFieldsAuditMetadata({
      source,
      fields: {
        scope,
        permission_id: after.permission_id,
        description: after.description,
        contained_permission_ids: after.contained_permission_ids,
      },
    }) ?? {
        source,
        scope,
        permission_id: after.permission_id,
      };
    await recordAuditEvent({
      tenancy: auth.tenancy,
      auth,
      action,
      metadata,
    });
    return;
  }

  if (action === "permission_definition.deleted") {
    const before = options.before;
    if (before == null) return;
    await recordAuditEvent({
      tenancy: auth.tenancy,
      auth,
      action,
      metadata: {
        source,
        scope,
        permission_id: before.permission_id,
        description: before.description,
        contained_permission_ids: before.contained_permission_ids,
      },
    });
    return;
  }

  // updated
  const before = options.before;
  const after = options.after;
  if (before == null || after == null) return;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options.patch ?? {})) {
    if (value !== undefined) {
      // CRUD uses `id` for renames; audit snapshots use permission_id.
      if (key === "id") {
        patch.permission_id = value;
      } else {
        patch[key] = value;
      }
    }
  }
  // Always include scope so the details column shows team vs project.
  const metadata = buildUpdatedFieldsAuditMetadata({
    source,
    patch: Object.keys(patch).length > 0 ? patch : {
      permission_id: after.permission_id,
      description: after.description,
      contained_permission_ids: after.contained_permission_ids,
    },
    beforeRoot: before,
    afterRoot: after,
  });
  if (metadata == null) return;
  await recordAuditEvent({
    tenancy: auth.tenancy,
    auth,
    action,
    metadata: {
      ...metadata,
      scope,
      permission_id: after.permission_id,
      ...(before.permission_id !== after.permission_id
        ? { old_permission_id: before.permission_id }
        : {}),
    },
  });
}

export function readPermissionDefinitionSnapshot(
  tenancy: Tenancy,
  permissionId: string,
  scope: PermissionDefinitionScope,
): PermissionDefinitionSnapshot | null {
  return snapshotPermissionDefinitionFromConfig(tenancy, permissionId, scope);
}

export function permissionDefinitionResultToSnapshot(
  result: {
    id: string,
    description?: string | null,
    contained_permission_ids: string[],
  },
  scope: PermissionDefinitionScope,
): PermissionDefinitionSnapshot {
  return {
    permission_id: result.id,
    description: result.description ?? null,
    contained_permission_ids: result.contained_permission_ids,
    scope,
  };
}
