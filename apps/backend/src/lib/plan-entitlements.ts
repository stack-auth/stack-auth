import { getItemQuantityForCustomer } from "@/lib/payments/customer-data";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { ITEM_IDS } from "@stackframe/stack-shared/dist/plans";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from "./tenancies";

/**
 * Whether Stack Auth's own plan-limit enforcement (quotas like `analytics_events`,
 * `session_replays`, `emails_per_month`, the `auth_users` soft cap, and the
 * `dashboard_admins` seat check) should be enforced for billing teams in the
 * internal tenancy.
 *
 * Setting `STACK_DISABLE_PLAN_LIMITS=true` short-circuits every enforcement
 * site BEFORE the underlying `getItem` lookup, so missing item config (e.g.
 * a deploy where the internal tenancy hasn't been migrated to include the
 * new items yet) cannot cascade into 500s either.
 *
 * Intended as a temporary cutover safety net while the plan-limits
 * infrastructure rolls out to prod; the flag should be removed once we trust
 * enforcement to behave correctly in every environment.
 *
 * Customer projects' own item APIs (`/payments/items/.../update-quantity`)
 * are unaffected by this flag.
 */
export function arePlanLimitsEnforced(): boolean {
  return getEnvVariable("STACK_DISABLE_PLAN_LIMITS", "false") !== "true";
}

type GlobalPrismaLike = {
  project: {
    findMany: (args: { where: { ownerTeamId: string }, select: { id: true } }) => Promise<Array<{ id: string }>>,
  },
  tenancy: {
    findMany: (args: { where: { projectId: { in: string[] } }, select: { id: true } }) => Promise<Array<{ id: string }>>,
  },
  projectUser: {
    count: (args: { where: { tenancyId: { in: string[] }, isAnonymous: boolean } }) => Promise<number>,
  },
};

type ItemCapacityReaders = {
  getPrismaForTenancy: (tenancy: Tenancy) => Promise<unknown>,
  getItemQuantityForCustomer: (options: {
    prisma: unknown,
    tenancyId: string,
    customerId: string,
    customerType: "team",
    itemId: string,
  }) => Promise<number>,
};

const TEAM_WIDE_CAPACITY_ITEM_IDS = new Set<string>([
  ITEM_IDS.authUsers,
  ITEM_IDS.seats,
]);

export function getBillingTeamId(project: { id: string, ownerTeamId?: string | null, owner_team_id?: string | null }): string | null {
  return project.ownerTeamId ?? project.owner_team_id ?? null;
}

async function getInternalBillingTenancy(): Promise<Tenancy> {
  const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
  if (tenancy == null) {
    throw new StackAssertionError("Internal billing tenancy not found", {
      billingProjectId: "internal",
      branchId: DEFAULT_BRANCH_ID,
    });
  }
  return tenancy;
}

export async function getOwnedProjectIdsForBillingTeam(
  billingTeamId: string,
  globalPrisma: GlobalPrismaLike = globalPrismaClient,
): Promise<string[]> {
  const projects = await globalPrisma.project.findMany({
    where: {
      ownerTeamId: billingTeamId,
    },
    select: {
      id: true,
    },
  });
  return projects.map((project) => project.id);
}

export async function getOwnedTenancyIdsForBillingTeam(
  billingTeamId: string,
  globalPrisma: GlobalPrismaLike = globalPrismaClient,
): Promise<string[]> {
  const projectIds = await getOwnedProjectIdsForBillingTeam(billingTeamId, globalPrisma);
  if (projectIds.length === 0) {
    return [];
  }
  const tenancies = await globalPrisma.tenancy.findMany({
    where: {
      projectId: {
        in: projectIds,
      },
    },
    select: {
      id: true,
    },
  });
  return tenancies.map((tenancy) => tenancy.id);
}

export async function getTeamWideNonAnonymousUserCount(
  billingTeamId: string,
  globalPrisma: GlobalPrismaLike = globalPrismaClient,
): Promise<number> {
  // Usage metric: how many non-anonymous users are currently consumed by this billing team.
  // This is compared against auth user capacity to determine over-limit conditions.
  const tenancyIds = await getOwnedTenancyIdsForBillingTeam(billingTeamId, globalPrisma);
  if (tenancyIds.length === 0) {
    return 0;
  }
  return await globalPrisma.projectUser.count({
    where: {
      tenancyId: {
        in: tenancyIds,
      },
      isAnonymous: false,
    },
  });
}

async function getTeamWideItemCapacity(
  billingTeamId: string,
  itemId: string,
  readers: ItemCapacityReaders = {
    getPrismaForTenancy: getPrismaClientForTenancy,
    getItemQuantityForCustomer: async (readerOptions) => (
      await getItemQuantityForCustomer(readerOptions as Parameters<typeof getItemQuantityForCustomer>[0])
    ),
  },
): Promise<number> {
  // Capacity metric: entitlement from Stack Auth payments for a specific item.
  if (!TEAM_WIDE_CAPACITY_ITEM_IDS.has(itemId)) {
    throw new StackAssertionError("Unsupported team-wide capacity item id", { itemId });
  }
  const internalBillingTenancy = await getInternalBillingTenancy();
  const billingPrisma = await readers.getPrismaForTenancy(internalBillingTenancy);
  return await readers.getItemQuantityForCustomer({
    prisma: billingPrisma,
    tenancyId: internalBillingTenancy.id,
    customerId: billingTeamId,
    customerType: "team",
    itemId,
  });
}

export async function getTeamWideItemCapacityForTests(
  billingTeamId: string,
  itemId: string,
  readers: ItemCapacityReaders,
): Promise<number> {
  return await getTeamWideItemCapacity(billingTeamId, itemId, readers);
}

export async function getTeamWideAuthUsersCapacity(
  billingTeamId: string,
): Promise<number> {
  return await getTeamWideItemCapacity(billingTeamId, ITEM_IDS.authUsers);
}

export async function getTeamWideDashboardAdminsCapacity(
  billingTeamId: string,
): Promise<number> {
  return await getTeamWideItemCapacity(billingTeamId, ITEM_IDS.seats);
}

export async function getTeamWideAuthUsersCapacityForProjectTenancy(
  projectTenancy: Tenancy,
): Promise<number> {
  const billingTeamId = getBillingTeamId(projectTenancy.project);
  if (billingTeamId == null) {
    throw new StackAssertionError("Project owner team missing; cannot resolve billing team", {
      projectId: projectTenancy.project.id,
    });
  }
  return await getTeamWideAuthUsersCapacity(billingTeamId);
}
