import { prismaClient } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { fullProjectInclude, getProject, projectPrismaToCrud } from "./projects";

export const fullTenancyInclude = {
  project: {
    include: fullProjectInclude,
  },
} as const satisfies Prisma.TenancyInclude;

export function tenancyPrismaToCrud(prisma: Prisma.TenancyGetPayload<{ include: typeof fullTenancyInclude }>) {
  if (prisma.hasNoOrganization && prisma.organizationId !== null) {
    throw new StackAssertionError("Organization ID is not null for a tenancy with hasNoOrganization", { tenancyId: prisma.id, prisma });
  }
  if (!prisma.hasNoOrganization && prisma.organizationId === null) {
    throw new StackAssertionError("Organization ID is null for a tenancy without hasNoOrganization", { tenancyId: prisma.id, prisma });
  }

  const projectCrud = projectPrismaToCrud(prisma.project);
  return {
    id: prisma.id,
    config: projectCrud.config,
    branchId: prisma.branchId,
    organization: {
      // TODO actual organization type
      id: prisma.organizationId,
    },
    project: projectCrud,
  };
}

export type Tenancy = Awaited<ReturnType<typeof tenancyPrismaToCrud>>;

/**
 * while not necessary, this cache just makes performance a little better
 * 
 * eventually, we'll nicely pass around tenancies and won't need this function anymore, so the cache is a good temp
 * solution
 */
const soleTenanciesCache = new Map<string, Tenancy>();

/**
  * @deprecated This is a temporary function for the situation where every project has exactly one tenancy. Later,
  * we will support multiple tenancies per project, and all uses of this function will be refactored.
  */
export async function getSoleTenancyFromProject(projectId: string): Promise<Tenancy>;
/**
  * @deprecated This is a temporary function for the situation where every project has exactly one tenancy. Later,
  * we will support multiple tenancies per project, and all uses of this function will be refactored.
  */
export async function getSoleTenancyFromProject(projectId: string, returnNullIfNotFound: boolean): Promise<Tenancy | null>;
export async function getSoleTenancyFromProject(projectId: string, returnNullIfNotFound: boolean = false) {
  const tenancy = soleTenanciesCache.get(projectId) ?? await getTenancyFromProject(projectId, 'main', null);
  if (!tenancy) {
    if (returnNullIfNotFound) return null;

    const project = await getProject(projectId);
    if (!project) {
      throw new StackAssertionError(`Tried to find sole tenancy for project, but project not found for ID ${projectId}`, { projectId });
    }
    throw new StackAssertionError(`No tenancy found for project ${projectId}`, { projectId });
  }
  soleTenanciesCache.set(projectId, tenancy);
  return tenancy;
}

export async function getTenancy(tenancyId: string) {
  if (tenancyId === "internal") {
    throw new StackAssertionError("Tried to get tenancy with ID `internal`. This is a mistake because `internal` is only a valid identifier for projects.");
  }
  const prisma = await prismaClient.tenancy.findUnique({
    where: { id: tenancyId },
    include: fullTenancyInclude,
  });
  if (!prisma) return null;
  return tenancyPrismaToCrud(prisma);
}

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
    include: fullTenancyInclude,
  });
  if (!prisma) return null;
  return tenancyPrismaToCrud(prisma);
}

