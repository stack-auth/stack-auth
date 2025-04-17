import { createOrUpdateProject, listManagedProjectIds } from "@/lib/projects";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adminUserProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { projectIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// if one of these users creates a project, the others will be added as owners
const ownerPacks: Set<string>[] = [];

export const adminUserProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(adminUserProjectsCrud, {
  paramsSchema: yupObject({
    projectId: projectIdSchema.defined(),
  }),
  onPrepare: async ({ auth }) => {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired;
    }
    if (auth.project.id !== "internal") {
      throw new KnownErrors.ExpectedInternalProject();
    }
  },
  onCreate: async ({ auth, data }) => {
    const user = auth.user ?? throwErr('auth.user is required');
    const ownerPack = ownerPacks.find(p => p.has(user.id));
    const userIds = ownerPack ? [...ownerPack] : [user.id];

    return await createOrUpdateProject({
      ownerIds: userIds,
      branchId: 'main',
      type: 'create',
      data,
    });
  },
  onList: async ({ auth }) => {
    const results = await prismaClient.project.findMany({
      where: {
        id: { in: listManagedProjectIds(auth.user ?? throwErr('auth.user is required')) },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: await Promise.all(results.map(x => projectPrismaToCrud(x))),
      is_paginated: false,
    } as const;
  }
}));
