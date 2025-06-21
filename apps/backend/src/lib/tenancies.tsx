import { prismaClient, rawQuery } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getRenderedOrganizationConfigQuery, renderedOrganizationConfigToProjectCrud } from "./config";
import { getProject } from "./projects";

/**
 * @deprecated YOU PROBABLY ALMOST NEVER WANT TO USE THIS, UNLESS YOU ACTUALLY NEED THE DEFAULT BRANCH ID. DON'T JUST USE THIS TO GET A TENANCY BECAUSE YOU DON'T HAVE ONE
 *
 * one day we will replace this with a dynamic default branch ID that depends on the project, but for now you can use this constant
 *
 * NEVER EVER use the string "main" (otherwise we don't know what to replace when we add the dynamic default branch ID)
 *
 * // TODO do the thing above
 */
export const DEFAULT_BRANCH_ID = "main";

export async function tenancyPrismaToCrud(prisma: Prisma.TenancyGetPayload<{}>) {
  if (prisma.hasNoOrganization && prisma.organizationId !== null) {
    throw new StackAssertionError("Organization ID is not null for a tenancy with hasNoOrganization", { tenancyId: prisma.id, prisma });
  }
  if (!prisma.hasNoOrganization && prisma.organizationId === null) {
    throw new StackAssertionError("Organization ID is null for a tenancy without hasNoOrganization", { tenancyId: prisma.id, prisma });
  }

  const projectCrud = await getProject(prisma.projectId) ?? throwErr("Project in tenancy not found");

  const completeConfig = await rawQuery(prismaClient, getRenderedOrganizationConfigQuery({
    projectId: projectCrud.id,
    branchId: prisma.branchId,
    organizationId: prisma.organizationId,
  }));
  const oldProjectConfig = renderedOrganizationConfigToProjectCrud(completeConfig);

  return {
    id: prisma.id,
    /** @deprecated */
    config: oldProjectConfig,
    completeConfig,
    branchId: prisma.branchId,
    organization: prisma.organizationId === null ? null : {
      // TODO actual organization type
      id: prisma.organizationId,
    },
    project: projectCrud,
  };
}

export type Tenancy = Awaited<ReturnType<typeof tenancyPrismaToCrud>>;

/**
  * @deprecated This is a temporary function for the situation where every project-branch has exactly one tenancy. Later,
  * we will support multiple tenancies per project-branch, and all uses of this function will be refactored.
  */
export function getSoleTenancyFromProjectBranch(project: Omit<ProjectsCrud["Admin"]["Read"], "config"> | string, branchId: string): Promise<Tenancy>;
/**
  * @deprecated This is a temporary function for the situation where every project-branch has exactly one tenancy. Later,
  * we will support multiple tenancies per project-branch, and all uses of this function will be refactored.
  */
export function getSoleTenancyFromProjectBranch(project: Omit<ProjectsCrud["Admin"]["Read"], "config"> | string, branchId: string, returnNullIfNotFound: boolean): Promise<Tenancy | null>;
export async function getSoleTenancyFromProjectBranch(projectOrId: Omit<ProjectsCrud["Admin"]["Read"], "config"> | string, branchId: string, returnNullIfNotFound: boolean = false): Promise<Tenancy | null> {
  const res = await getTenancyFromProject(typeof projectOrId === 'string' ? projectOrId : projectOrId.id, branchId, null);
  if (!res) {
    if (returnNullIfNotFound) return null;
    throw new StackAssertionError(`No tenancy found for project ${typeof projectOrId === 'string' ? projectOrId : projectOrId.id}`, { projectOrId });
  }
  return res;
}

export async function getTenancy(tenancyId: string) {
  if (tenancyId === "internal") {
    throw new StackAssertionError("Tried to get tenancy with ID `internal`. This is a mistake because `internal` is only a valid identifier for projects.");
  }
  const prisma = await prismaClient.tenancy.findUnique({
    where: { id: tenancyId },
  });
  if (!prisma) return null;
  return await tenancyPrismaToCrud(prisma);
}

/**
 * @deprecated Not actually deprecated but if you're using this you're probably doing something wrong — ask Konsti for help
 */
export async function getTenancyFromProject(projectId: string, branchId: string, organizationId: string | null) {
  const prisma = await prismaClient.tenancy.findUnique({
    where: {
      ...(organizationId === null ? {
        projectId_branchId_hasNoOrganization: {
          projectId: projectId,
          branchId: branchId,
          hasNoOrganization: "TRUE",
        }
      } : {
        projectId_branchId_organizationId: {
          projectId: projectId,
          branchId: branchId,
          organizationId: organizationId,
        }
      }),
    },
  });
  if (!prisma) return null;
  return await tenancyPrismaToCrud(prisma);
}

