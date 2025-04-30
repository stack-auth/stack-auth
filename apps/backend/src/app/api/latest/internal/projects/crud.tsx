import { createOrUpdateProject, getProjectQuery, listManagedProjectIds } from "@/lib/projects";
import { prismaClient, rawQueryAll } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adminUserProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { projectIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
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
      initialBranchId: 'main',
      type: 'create',
      data,
    });
  },
  onList: async ({ auth }) => {
    const projectIds = listManagedProjectIds(auth.user ?? throwErr('auth.user is required'));
    const projectsRecord = await rawQueryAll(prismaClient, typedFromEntries(projectIds.map((id, index) => [index, getProjectQuery(id)])));
    const projects = await Promise.all(typedEntries(projectsRecord).map(async ([_, project]) => await project));

    if (projects.filter(x => x !== null).length !== projectIds.length) {
      throw new StackAssertionError('Failed to fetch all projects of a user');
    }

    return {
      items: projects as NonNullable<typeof projects[number]>[],
      is_paginated: false,
    } as const;
  }
}));
