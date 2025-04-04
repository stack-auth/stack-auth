import { createPermissionDefinition, deletePermissionDefinition, isErrorForNonUniquePermission, listPermissionDefinitions, updatePermissionDefinitions } from "@/lib/permissions";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { teamPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/team-permissions';
import { permissionDefinitionIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const teamPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(teamPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: permissionDefinitionIdSchema.defined(),
  }),
  async onCreate({ auth, data }) {
    return await retryTransaction(async (tx) => {
      try {
        return await createPermissionDefinition(tx, {
          scope: "TEAM",
          tenancy: auth.tenancy,
          data,
        });
      } catch (error) {
        if (isErrorForNonUniquePermission(error)) {
          throw new KnownErrors.PermissionIdAlreadyExists(data.id);
        }
        throw error;
      }
    });
  },
  async onUpdate({ auth, data, params }) {
    return await retryTransaction(async (tx) => {
      try {
        return await updatePermissionDefinitions(tx, {
          scope: "TEAM",
          tenancy: auth.tenancy,
          permissionId: params.permission_id,
          data,
        });
      } catch (error) {
        if (isErrorForNonUniquePermission(error)) {
          throw new KnownErrors.PermissionIdAlreadyExists(data.id ?? '');
        }
        throw error;
      }
    });
  },
  async onDelete({ auth, params }) {
    return await retryTransaction(async (tx) => {
      await deletePermissionDefinition(tx, {
        tenancy: auth.tenancy,
        permissionId: params.permission_id
      });
    });
  },
  async onList({ auth }) {
    return await retryTransaction(async (tx) => {
      return {
        items: await listPermissionDefinitions(tx, "TEAM", auth.tenancy),
        is_paginated: false,
      };
    });
  },
}));
