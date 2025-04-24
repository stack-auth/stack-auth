import { createProject, fullProjectInclude, listManagedProjectIds, projectPrismaToCrud } from "@/lib/projects";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adminUserProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { projectIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// if one of these users creates a project, the others will be added as owners
const ownerPacks: Set<string>[] = [];

// if the user is in this list, the project will not have sign-up enabled on creation
const disableSignUpByDefault = new Set([
  "c2c03bd1-5cbe-4493-8e3f-17d1e2d7ca43",
  "60b859bf-e148-4eff-9985-fe6e31c58a2a",
  "1343e3e7-dd7a-44a1-8752-701c0881da72",
]);

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

    return await createProject(userIds, {
      ...data,
      config: {
        ...data.config,
        sign_up_enabled: data.config?.sign_up_enabled ?? (disableSignUpByDefault.has(user.id) ? false : true),
      },
    });
  },
  onList: async ({ auth }) => {
    const results = await prismaClient.project.findMany({
      where: {
        id: { in: listManagedProjectIds(auth.user ?? throwErr('auth.user is required')) },
      },
      include: fullProjectInclude,
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: await Promise.all(results.map(x => projectPrismaToCrud(x))),
      is_paginated: false,
    } as const;
  }
}));
