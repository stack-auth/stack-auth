import { getItemQuantityForCustomer } from "@/lib/payments";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { ITEM_IDS } from "@stackframe/stack-shared/dist/plans";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import type { Tenancy } from "./tenancies";

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
    tenancy: Tenancy,
    customerId: string,
    customerType: "team",
    itemId: string,
  }) => Promise<number>,
};

const TEAM_WIDE_CAPACITY_ITEM_IDS = new Set<string>([
  ITEM_IDS.authUsers,
  ITEM_IDS.emailsPerMonth,
  ITEM_IDS.seats,
]);

function getBillingTeamIdOrThrow(project: { id: string, ownerTeamId?: string | null, owner_team_id?: string | null }): string {
  const ownerTeamId = project.ownerTeamId ?? project.owner_team_id ?? null;
  if (!ownerTeamId) {
    throw new StackAssertionError("Project owner team missing; cannot resolve billing team", {
      projectId: project.id,
    });
  }
  return ownerTeamId;
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

async function getTeamWideItemCapacity(options: {
  billingTenancy: Tenancy,
  billingTeamId: string,
  itemId: string,
}, readers: ItemCapacityReaders = {
  getPrismaForTenancy: getPrismaClientForTenancy,
  getItemQuantityForCustomer: async (readerOptions) => (
    await getItemQuantityForCustomer(readerOptions as Parameters<typeof getItemQuantityForCustomer>[0])
  ),
}): Promise<number> {
  // Capacity metric: entitlement from Stack Auth payments for a specific item.
  // Example: auth_users / emails_per_month / dashboard_admins.
  if (!TEAM_WIDE_CAPACITY_ITEM_IDS.has(options.itemId)) {
    throw new StackAssertionError("Unsupported team-wide capacity item id", {
      itemId: options.itemId,
    });
  }
  const billingPrisma = await readers.getPrismaForTenancy(options.billingTenancy);
  return await readers.getItemQuantityForCustomer({
    prisma: billingPrisma,
    tenancy: options.billingTenancy,
    customerId: options.billingTeamId,
    customerType: "team",
    itemId: options.itemId,
  });
}

export async function getTeamWideItemCapacityForTests(options: {
  billingTenancy: Tenancy,
  billingTeamId: string,
  itemId: string,
}, readers: ItemCapacityReaders): Promise<number> {
  return await getTeamWideItemCapacity(options, readers);
}

export async function getTeamWideAuthUsersCapacity(options: {
  billingTenancy: Tenancy,
  billingTeamId: string,
}): Promise<number> {
  return await getTeamWideItemCapacity({
    ...options,
    itemId: ITEM_IDS.authUsers,
  });
}

export async function getTeamWideEmailsPerMonthCapacity(options: {
  billingTenancy: Tenancy,
  billingTeamId: string,
}): Promise<number> {
  return await getTeamWideItemCapacity({
    ...options,
    itemId: ITEM_IDS.emailsPerMonth,
  });
}

export async function getTeamWideDashboardAdminsCapacity(options: {
  billingTenancy: Tenancy,
  billingTeamId: string,
}): Promise<number> {
  return await getTeamWideItemCapacity({
    ...options,
    itemId: ITEM_IDS.seats,
  });
}

export async function getTeamWideAuthUsersCapacityForProjectTenancy(
  projectTenancy: Tenancy,
  billingTenancy: Tenancy,
): Promise<number> {
  return await getTeamWideAuthUsersCapacity({
    billingTenancy,
    billingTeamId: getBillingTeamIdOrThrow(projectTenancy.project),
  });
}
