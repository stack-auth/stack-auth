import { getBranchConfigPushedError, getDevelopmentEnvironmentConfigWarnings, renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { createOrUpdateProjectWithLegacyConfig } from "@/lib/projects";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { yupObject } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    if (
      data.config?.email_theme &&
      !Object.keys(auth.tenancy.config.emails.themes).includes(data.config.email_theme)
    ) {
      throw new StatusError(400, "Invalid email theme");
    }
    const project = await createOrUpdateProjectWithLegacyConfig({
      type: "update",
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: data,
    });
    const tenancy = await getTenancy(auth.tenancy.id) ?? throwErr("Tenancy not found after project update?"); // since we updated the project, we need to re-fetch the new tenancy config
    return {
      ...project,
      pushed_config_error: await getBranchConfigPushedError({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
      }),
      config_warnings: await getDevelopmentEnvironmentConfigWarnings({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        organizationId: auth.tenancy.organization?.id ?? null,
      }),
      config: renderedOrganizationConfigToProjectCrud(tenancy.config),
    };
  },
  onRead: async ({ auth }) => {
    return {
      ...auth.project,
      pushed_config_error: await getBranchConfigPushedError({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
      }),
      config_warnings: await getDevelopmentEnvironmentConfigWarnings({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        organizationId: auth.tenancy.organization?.id ?? null,
      }),
      config: renderedOrganizationConfigToProjectCrud(auth.tenancy.config),
    };
  },
  onDelete: async ({ auth }) => {
    await retryTransaction(globalPrismaClient, async (tx) => {
      // ProjectUser intentionally has no tenancy cascade because deleting an
      // individual user preserves its Contact. For whole-project deletion,
      // remove users first so the Contact restriction cannot block the Tenancy
      // cascade that follows.
      await tx.projectUser.deleteMany({
        where: { mirroredProjectId: auth.project.id },
      });
      await tx.project.delete({
        where: {
          id: auth.project.id
        }
      });
    });
  }
}));
