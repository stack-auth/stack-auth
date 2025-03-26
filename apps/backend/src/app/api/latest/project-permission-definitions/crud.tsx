import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinitions } from "@/lib/permissions";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/project-permissions';
import { permissionDefinitionIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const projectPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: permissionDefinitionIdSchema.defined(),
  }),
  async onCreate({ auth, data }) {
    return await retryTransaction(async (tx) => {
      return await createPermissionDefinition(tx, {
        scope: "PROJECT",
        tenancy: auth.tenancy,
        data,
      });
    });
  },
  async onUpdate({ auth, data, params }) {
    return await retryTransaction(async (tx) => {
      return await updatePermissionDefinitions(tx, {
        scope: "PROJECT",
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
        items: await listPermissionDefinitions(tx, "PROJECT", auth.tenancy),
        is_paginated: false,
      };
    });
  },
}));
