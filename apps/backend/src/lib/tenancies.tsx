import { globalPrismaClient, RawQuery, rawQuery } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { getRenderedOrganizationConfigQuery } from "./config";
import { getProject, getProjectQuery } from "./projects";

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

/**
 * @deprecated UNUSED: This function is only kept for development mode validation in getTenancyFromProject.
 * The old Prisma-based implementation, replaced by getTenancyFromProjectQuery which uses RawQuery.
 */
async function tenancyPrismaToCrudUnused(prisma: Prisma.TenancyGetPayload<{}>) {
  if (prisma.hasNoOrganization && prisma.organizationId !== null) {
    throw new StackAssertionError("Organization ID is not null for a tenancy with hasNoOrganization", { tenancyId: prisma.id, prisma });
  }
  if (!prisma.hasNoOrganization && prisma.organizationId === null) {
    throw new StackAssertionError("Organization ID is null for a tenancy without hasNoOrganization", { tenancyId: prisma.id, prisma });
  }

  const projectCrud = await getProject(prisma.projectId) ?? throwErr("Project in tenancy not found");

  const config = await rawQuery(globalPrismaClient, getRenderedOrganizationConfigQuery({
    projectId: projectCrud.id,
    branchId: prisma.branchId,
    organizationId: prisma.organizationId,
  }));

  return {
    id: prisma.id,
    config,
    branchId: prisma.branchId,
    organization: prisma.organizationId === null ? null : {
      // TODO actual organization type
      id: prisma.organizationId,
    },
    project: projectCrud,
  };
}

export type Tenancy = Awaited<ReturnType<typeof tenancyPrismaToCrudUnused>>;

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
  const res = await rawQuery(globalPrismaClient, getSoleTenancyFromProjectBranchQuery(projectOrId, branchId, true));
  if (!res) {
    if (returnNullIfNotFound) return null;
    throw new StackAssertionError(`No tenancy found for project ${typeof projectOrId === 'string' ? projectOrId : projectOrId.id}`, { projectOrId });
  }
  return res;
}

/**
  * @deprecated This is a temporary function for the situation where every project-branch has exactly one tenancy. Later,
  * we will support multiple tenancies per project-branch, and all uses of this function will be refactored.
 */
export function getSoleTenancyFromProjectBranchQuery(project: Omit<ProjectsCrud["Admin"]["Read"], "config"> | string, branchId: string, returnNullIfNotFound: true): RawQuery<Promise<Tenancy | null>> {
  return getTenancyFromProjectQuery(typeof project === 'string' ? project : project.id, branchId, null);
}

export async function getTenancy(tenancyId: string) {
  if (tenancyId === "internal") {
    throw new StackAssertionError("Tried to get tenancy with ID `internal`. This is a mistake because `internal` is only a valid identifier for projects.");
  }
  const prisma = await globalPrismaClient.tenancy.findUnique({
    where: { id: tenancyId },
  });
  if (!prisma) return null;
  return await getTenancyFromProject(prisma.projectId, prisma.branchId, prisma.organizationId);
}

function getTenancyFromProjectQuery(projectId: string, branchId: string, organizationId: string | null): RawQuery<Promise<Tenancy | null>> {
  return RawQuery.then(
    RawQuery.all([
      {
        supportedPrismaClients: ["global"],
        sql: organizationId === null
          ? Prisma.sql`
              SELECT "Tenancy".*
              FROM "Tenancy"
              WHERE "Tenancy"."projectId" = ${projectId}
              AND "Tenancy"."branchId" = ${branchId}
              AND "Tenancy"."hasNoOrganization" = 'TRUE'
            `
          : Prisma.sql`
              SELECT "Tenancy".*
              FROM "Tenancy"
              WHERE "Tenancy"."projectId" = ${projectId}
              AND "Tenancy"."branchId" = ${branchId}
              AND "Tenancy"."organizationId" = ${organizationId}
            `,
        postProcess: (queryResult) => {
          if (queryResult.length > 1) {
            throw new StackAssertionError(
              `Expected 0 or 1 tenancies for project ${projectId}, branch ${branchId}, organization ${organizationId}, got ${queryResult.length}`,
              { queryResult }
            );
          }
          if (queryResult.length === 0) {
            return Promise.resolve(null);
          }
          return Promise.resolve(queryResult[0] as Prisma.TenancyGetPayload<{}>);
        },
      },
      getProjectQuery(projectId),
      getRenderedOrganizationConfigQuery({
        projectId,
        branchId,
        organizationId,
      }),
    ] as const),
    async ([tenancyResultPromise, projectResultPromise, configPromise]) => {
      const [tenancyResult, projectResult, config] = await Promise.all([
        tenancyResultPromise,
        projectResultPromise,
        configPromise,
      ]);

      if (!tenancyResult) return null;
      if (!projectResult) {
        throw new StackAssertionError("Project in tenancy not found", { projectId, tenancyId: tenancyResult.id });
      }

      // Validate tenancy consistency
      if (tenancyResult.hasNoOrganization && tenancyResult.organizationId !== null) {
        throw new StackAssertionError("Organization ID is not null for a tenancy with hasNoOrganization", {
          tenancyId: tenancyResult.id,
          tenancy: tenancyResult
        });
      }
      if (!tenancyResult.hasNoOrganization && tenancyResult.organizationId === null) {
        throw new StackAssertionError("Organization ID is null for a tenancy without hasNoOrganization", {
          tenancyId: tenancyResult.id,
          tenancy: tenancyResult
        });
      }

      return {
        id: tenancyResult.id,
        config,
        branchId: tenancyResult.branchId,
        organization: tenancyResult.organizationId === null ? null : {
          // TODO actual organization type
          id: tenancyResult.organizationId,
        },
        project: projectResult,
      };
    }
  );
}

/**
 * @deprecated Not actually deprecated but if you're using this you're probably doing something wrong — ask Konsti for help
 *
 * (if Konsti is not around — unless you are editing the implementation of SmartRequestAuth, you should probably take the
 * tenancy from the SmartRequest auth parameter instead of fetching your own. If you are editing the SmartRequestAuth
 * implementation — carry on.)
 */
export async function getTenancyFromProject(projectId: string, branchId: string, organizationId: string | null) {
  // Use the new RawQuery implementation
  const result = await rawQuery(globalPrismaClient, getTenancyFromProjectQuery(projectId, branchId, organizationId));

  // In development mode, compare with the old implementation to ensure correctness
  if (!!getNodeEnvironment().includes("prod")) {
    const prisma = await globalPrismaClient.tenancy.findUnique({
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
    const oldResult = prisma ? await tenancyPrismaToCrudUnused(prisma) : null;

    // Compare the two results
    if (!deepPlainEquals(result, oldResult)) {
      throw new StackAssertionError("getTenancyFromProject: new implementation does not match old implementation", {
        projectId,
        branchId,
        organizationId,
        newResult: result,
        oldResult,
      });
    }
  }

  return result;
}

