import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinitions } from "@/lib/permissions";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { userPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/user-permissions';
import { teamPermissionDefinitionIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const userPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(userPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: teamPermissionDefinitionIdSchema.defined(),
  }),
  async onCreate({ auth, data }) {
    return await retryTransaction(async (tx) => {
      return await createPermissionDefinition(tx, {
        scope: "USER",
        tenancy: auth.tenancy,
        data,
      });
    });
  },
  async onUpdate({ auth, data, params }) {
    return await retryTransaction(async (tx) => {
      return await updatePermissionDefinitions(tx, {
        scope: "USER",
        tenancy: auth.tenancy,
        permissionId: params.permission_id,
        data,
      });
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
        items: await listPermissionDefinitions(tx, "USER", auth.tenancy),
        is_paginated: false,
      };
    });
  },
}));
