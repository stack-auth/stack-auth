import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinition } from "@/lib/permissions";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { teamPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/team-permissions';
import { permissionDefinitionIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const teamPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(teamPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: permissionDefinitionIdSchema.defined(),
  }),
  async onCreate({ auth, data }) {
    return await retryTransaction(async (tx) => {
      return await createPermissionDefinition(tx, {
        scope: "team",
        tenancy: auth.tenancy,
        data,
      });
    });
  },
  async onUpdate({ auth, data, params }) {
    return await retryTransaction(async (tx) => {
      return await updatePermissionDefinition(tx, {
        oldId: params.permission_id,
        scope: "team",
        tenancy: auth.tenancy,
        data: {
          id: data.id,
          description: data.description,
          contained_permission_ids: data.contained_permission_ids,
        }
      });
    });
  },
  async onDelete({ auth, params }) {
    return await retryTransaction(async (tx) => {
      await deletePermissionDefinition(tx, {
        scope: "team",
        tenancy: auth.tenancy,
        permissionId: params.permission_id
      });
    });
  },
  async onList({ auth }) {
    return {
      items: await listPermissionDefinitions({
        scope: "team",
        tenancy: auth.tenancy,
      }),
      is_paginated: false,
    };
  },
}));
