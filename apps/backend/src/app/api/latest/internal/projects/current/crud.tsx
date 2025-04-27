import { createOrUpdateProject } from "@/lib/projects";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    return await createOrUpdateProject({
      type: "update",
      projectId: auth.project.id,
      data: data,
    });
  },
  onRead: async ({ auth }) => {
    return auth.project;
  },
  onDelete: async ({ auth }) => {
    await retryTransaction(async (tx) => {
      await tx.project.delete({
        where: {
          id: auth.project.id
        }
      });

      // delete managed ids from users
      const users = await tx.projectUser.findMany({
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

        await tx.projectUser.update({
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
    });
  }
}));
