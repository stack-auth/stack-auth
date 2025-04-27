import { prismaClient, rawQuery } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getRenderedOrganizationConfigQuery } from "./config";
import { getProject } from "./projects";

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

  return {
    id: prisma.id,
    /** @deprecated */
    config: projectCrud.config,
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
 * while not necessary, this cache just makes performance a little better
 *
 * eventually, we'll nicely pass around tenancies and won't need this function anymore, so the cache is a good temp
 * solution
 */
const soleTenancyIdsCache = new Map<string, string>();

/**
  * @deprecated This is a temporary function for the situation where every project has exactly one tenancy. Later,
  * we will support multiple tenancies per project, and all uses of this function will be refactored.
  */
export function getSoleTenancyFromProject(project: ProjectsCrud["Admin"]["Read"] | string): Promise<Tenancy>;
/**
  * @deprecated This is a temporary function for the situation where every project has exactly one tenancy. Later,
  * we will support multiple tenancies per project, and all uses of this function will be refactored.
  */
export function getSoleTenancyFromProject(project: ProjectsCrud["Admin"]["Read"] | string, returnNullIfNotFound: boolean): Promise<Tenancy | null>;
export async function getSoleTenancyFromProject(projectOrId: ProjectsCrud["Admin"]["Read"] | string, returnNullIfNotFound: boolean = false): Promise<Tenancy | null> {
  let project;
  if (!projectOrId) {
    throw new StackAssertionError("Project is required", { projectOrId });
  }
  if (typeof projectOrId === 'string') {
    project = await getProject(projectOrId);
  } else {
    project = projectOrId;
  }
  if (!project) {
    if (returnNullIfNotFound) return null;
    throw new StackAssertionError(`Project ${projectOrId} does not exist`, { projectOrId });
  }
  const tenancyId = (!getNodeEnvironment().includes('development') ? soleTenancyIdsCache.get(project.id) : null) ?? (await getTenancyFromProject(project.id, 'main', null))?.id;
  if (!tenancyId) {
    if (returnNullIfNotFound) return null;
    throw new StackAssertionError(`No tenancy found for project ${project.id}`, { project });
  }
  soleTenancyIdsCache.set(project.id, tenancyId);

  const completeConfig = await rawQuery(prismaClient, getRenderedOrganizationConfigQuery({
    projectId: project.id,
    branchId: "main",
    organizationId: null,
  }));

  return {
    id: tenancyId,
    config: project.config,
    completeConfig,
    branchId: "main",
    organization: null,
    project: project,
  };
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

