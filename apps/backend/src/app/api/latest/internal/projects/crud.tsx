import { renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { createOrUpdateProjectWithLegacyConfig, getProjectQuery, listManagedProjectIds } from "@/lib/projects";
import { ensureTeamMembershipExists } from "@/lib/request-checks";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, rawQueryAll } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@hexclave/shared";
import { adminUserProjectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { projectIdSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { isNotNull, typedEntries, typedFromEntries } from "@hexclave/shared/dist/utils/objects";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

export const adminUserProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(adminUserProjectsCrud, {
  paramsSchema: yupObject({
    projectId: projectIdSchema.defined(),
  }),
  onPrepare: async ({ auth }) => {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (auth.project.id !== "internal") {
      throw new KnownErrors.ExpectedInternalProject();
    }
  },
  onCreate: async ({ auth, data }) => {
    const user = auth.user ?? throwErr('auth.user is required');
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await ensureTeamMembershipExists(prisma, {
      tenancyId: auth.tenancy.id,
      teamId: data.owner_team_id,
      userId: user.id,
    });

    const project = await createOrUpdateProjectWithLegacyConfig({
      type: 'create',
      data: {
        ...data,
        config: {
          allow_localhost: true,
          ...data.config,
        },
      },
    });
    const tenancy = await getSoleTenancyFromProjectBranch(project.id, DEFAULT_BRANCH_ID);

    return {
      ...project,
      config: renderedOrganizationConfigToProjectCrud(tenancy.config),
    };
  },
  onList: async ({ auth }) => {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    const projectIds = await listManagedProjectIds(auth.user ?? throwErr('auth.user is required'));
    const projectsRecord = await rawQueryAll(globalPrismaClient, typedFromEntries(projectIds.map((id, index) => [index, getProjectQuery(id)])));
    const projects = (await Promise.all(typedEntries(projectsRecord).map(async ([_, project]) => await project))).filter(isNotNull);

    if (projects.length !== projectIds.length) {
      throw new HexclaveAssertionError('Failed to fetch all projects of a user');
    }

    const projectsWithConfig = await Promise.all(projects.map(async (project) => {
      return {
        ...project,
        config: renderedOrganizationConfigToProjectCrud((await getSoleTenancyFromProjectBranch(project.id, DEFAULT_BRANCH_ID)).config),
      };
    }));

    return {
      items: projectsWithConfig,
      is_paginated: false,
    } as const;
  }
}));
