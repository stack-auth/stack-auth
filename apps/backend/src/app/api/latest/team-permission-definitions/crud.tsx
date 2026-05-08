import { createPermissionDefinition, deletePermissionDefinition, listPermissionDefinitions, updatePermissionDefinition } from "@/lib/permissions";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { teamPermissionDefinitionsCrud } from '@stackframe/stack-shared/dist/interface/crud/team-permissions';
import { permissionDefinitionIdSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { paginatePermissionDefinitions } from "../permission-definitions-pagination";

export const teamPermissionDefinitionsCrudHandlers = createLazyProxy(() => createCrudHandlers(teamPermissionDefinitionsCrud, {
  paramsSchema: yupObject({
    permission_id: permissionDefinitionIdSchema.defined(),
  }),
  querySchema: yupObject({
    limit: yupNumber().integer().min(1).optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Maximum number of items to return. When set, the response is paginated via cursor." } }),
    cursor: yupString().optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Cursor (permission id) to start the next page from." } }),
    query: yupString().optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: "Free-text filter applied to permission id and description (case-insensitive)." } }),
  }),
  async onCreate({ auth, data }) {
    return await createPermissionDefinition(
      globalPrismaClient,
      {
        scope: "team",
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
        scope: "team",
        tenancy: auth.tenancy,
        data: {
          id: data.id,
          description: data.description,
          contained_permission_ids: data.contained_permission_ids,
        }
      }
    );
  },
  async onDelete({ auth, params }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await deletePermissionDefinition(
      globalPrismaClient,
      prisma,
      {
        scope: "team",
        tenancy: auth.tenancy,
        permissionId: params.permission_id
      }
    );
  },
  async onList({ auth, query }) {
    const all = await listPermissionDefinitions({
      scope: "team",
      tenancy: auth.tenancy,
    });
    return paginatePermissionDefinitions(all, query);
  },
}));
