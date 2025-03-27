import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinitions } from "@/lib/permissions";
import { prismaTransaction } from "@/prisma-client";
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
    return await prismaTransaction(async (tx) => {
      return await createPermissionDefinition(tx, {
        scope: "TEAM",
        tenancy: auth.tenancy,
        data,
      });
    }).catchUniqueConstraintViolation(async () => {
      throw new KnownErrors.PermissionIdAlreadyExists(data.id);
    })
      .runWithRetry();
  },
  async onUpdate({ auth, data, params }) {
    return await prismaTransaction(async (tx) => {
      return await updatePermissionDefinitions(tx, {
        scope: "TEAM",
        tenancy: auth.tenancy,
        permissionId: params.permission_id,
        data,
      });
    }).catchUniqueConstraintViolation(async () => {
      throw new KnownErrors.PermissionIdAlreadyExists(data.id ?? '');
    })
      .runWithRetry();
  },
  async onDelete({ auth, params }) {
    return await prismaTransaction(async (tx) => {
      await deletePermissionDefinition(tx, {
        tenancy: auth.tenancy,
        permissionId: params.permission_id
      });
    })
      .runWithRetry();
  },
  async onList({ auth }) {
    return await prismaTransaction(async (tx) => {
      return {
        items: await listPermissionDefinitions(tx, "TEAM", auth.tenancy),
        is_paginated: false,
      };
    })
      .runWithRetry();
  },
}));
