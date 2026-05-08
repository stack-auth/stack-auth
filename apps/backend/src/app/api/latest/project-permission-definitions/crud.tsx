import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinition } from "@/lib/permissions";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/project-permissions';
import { permissionDefinitionIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { paginatePermissionDefinitions, permissionDefinitionsListQuerySchema } from "../permission-definitions-pagination";


export const projectPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: permissionDefinitionIdSchema.defined(),
  }),
  querySchema: permissionDefinitionsListQuerySchema,
  async onCreate({ auth, data }) {
    return await createPermissionDefinition(
      globalPrismaClient,
      {
        scope: "project",
        tenancy: auth.tenancy,
        data,
      }
    );
  },
  async onUpdate({ auth, data, params }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await updatePermissionDefinition(
      globalPrismaClient,
      prisma,
      {
        oldId: params.permission_id,
        scope: "project",
        tenancy: auth.tenancy,
        data,
      }
    );
  },
  async onDelete({ auth, params }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await deletePermissionDefinition(
      globalPrismaClient,
      prisma,
      {
        scope: "project",
        tenancy: auth.tenancy,
        permissionId: params.permission_id
      }
    );
  },
  async onList({ auth, query }) {
    const all = await listPermissionDefinitions({
      scope: "project",
      tenancy: auth.tenancy,
    });
    return paginatePermissionDefinitions(all, query);
  },
}));
