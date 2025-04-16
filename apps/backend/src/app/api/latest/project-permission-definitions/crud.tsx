import { createOrUpdatePermissionDefinition, deletePermissionDefinition, listPermissionDefinitions } from "@/lib/permissions";
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
      return await createOrUpdatePermissionDefinition(tx, {
        type: "create",
        scope: "project",
        tenancy: auth.tenancy,
        data,
      });
    });
  },
  async onUpdate({ auth, data, params }) {
    return await retryTransaction(async (tx) => {
      return await createOrUpdatePermissionDefinition(tx, {
        type: "update",
        scope: "project",
        tenancy: auth.tenancy,
        data: {
          ...data,
          id: params.permission_id,
        },
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
    return {
      items: await listPermissionDefinitions({
        scope: "project",
        tenancy: auth.tenancy,
      }),
      is_paginated: false,
    };
  },
}));
