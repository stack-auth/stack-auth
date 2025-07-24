import { createOrUpdateProject } from "@/lib/projects";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    if (
      data.config?.email_theme &&
      !Object.keys(auth.tenancy.completeConfig.emails.themeList).includes(data.config.email_theme)
    ) {
      throw new StatusError(400, "Invalid email theme");
    }
    const project = await createOrUpdateProject({
      type: "update",
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: data,
    });
    const tenancy = await getTenancy(auth.tenancy.id) ?? throwErr("Tenancy not found after project update?"); // since we updated the project, we need to re-fetch the new tenancy config
    return {
      ...project,
      config: tenancy.config,
    };
  },
  onRead: async ({ auth }) => {
    return {
      ...auth.project,
      config: auth.tenancy.config,
    };
  },
  onDelete: async ({ auth }) => {
    await globalPrismaClient.project.delete({
      where: {
        id: auth.project.id
      }
    });

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // delete managed ids from users
    const users = await prisma.projectUser.findMany({
      where: {
        mirroredProjectId: 'internal',
        serverMetadata: {
          path: ['managedProjectIds'],
          array_contains: auth.project.id
        }
      }
    });

    for (const user of users) {
      const updatedManagedProjectIds = (user.serverMetadata as any).managedProjectIds.filter(
          (id: any) => id !== auth.project.id
        ) as string[];

      await prisma.projectUser.update({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: 'internal',
            mirroredBranchId: user.mirroredBranchId,
            projectUserId: user.projectUserId
          }
        },
        data: {
          serverMetadata: {
            ...user.serverMetadata as any,
            managedProjectIds: updatedManagedProjectIds,
          }
        }
      });
    }
  }
}));
