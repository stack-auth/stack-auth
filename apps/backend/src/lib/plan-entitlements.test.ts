import type { PrismaClientTransaction } from "@/prisma-client";
import { ITEM_IDS, PLAN_LIMITS } from "@stackframe/stack-shared/dist/plans";
import { describe, expect, it } from "vitest";
import {
  getBillingTeamId,
  getOwnedProjectIdsForBillingTeam,
  getOwnedTenancyIdsForBillingTeam,
  getTeamWideItemCapacityForTests,
  getTeamWideNonAnonymousUserCount,
} from "./plan-entitlements";

type ProjectRow = { id: string, ownerTeamId: string | null };
type TenancyRow = { id: string, projectId: string };
type ProjectUserRow = { tenancyId: string, isAnonymous: boolean };

function createGlobalPrismaStub(state: {
  projects: ProjectRow[],
  tenancies: TenancyRow[],
  projectUsers: ProjectUserRow[],
}) {
  return {
    project: {
      findMany: async (args: { where: { ownerTeamId: string }, select: { id: true } }) => {
        return state.projects
          .filter((project) => project.ownerTeamId === args.where.ownerTeamId)
          .map((project) => ({ id: project.id }));
      },
    },
    tenancy: {
      findMany: async (args: { where: { projectId: { in: string[] } }, select: { id: true } }) => {
        return state.tenancies
          .filter((tenancy) => args.where.projectId.in.includes(tenancy.projectId))
          .map((tenancy) => ({ id: tenancy.id }));
      },
    },
    projectUser: {
      count: async (args: { where: { tenancyId: { in: string[] }, isAnonymous: boolean } }) => {
        return state.projectUsers.filter((user) => (
          args.where.tenancyId.in.includes(user.tenancyId) &&
          user.isAnonymous === args.where.isAnonymous
        )).length;
      },
    },
  };
}

describe("getBillingTeamId", () => {
  it("returns ownerTeamId when present", () => {
    expect(getBillingTeamId({ id: "p1", ownerTeamId: "team-1" })).toBe("team-1");
  });

  it("returns owner_team_id when ownerTeamId is absent", () => {
    expect(getBillingTeamId({ id: "p1", owner_team_id: "team-2" })).toBe("team-2");
  });

  it("returns null when neither is present", () => {
    expect(getBillingTeamId({ id: "p1", ownerTeamId: null, owner_team_id: null })).toBe(null);
  });

  it("prefers ownerTeamId over owner_team_id", () => {
    expect(getBillingTeamId({ id: "p1", ownerTeamId: "team-camel", owner_team_id: "team-snake" })).toBe("team-camel");
  });
});

describe("team-wide ownership aggregation", () => {
  const globalPrisma = createGlobalPrismaStub({
    projects: [
      { id: "project-a", ownerTeamId: "team-1" },
      { id: "project-b", ownerTeamId: "team-1" },
      { id: "project-c", ownerTeamId: "team-2" },
      { id: "project-d", ownerTeamId: null },
    ],
    tenancies: [
      { id: "tenancy-a-main", projectId: "project-a" },
      { id: "tenancy-a-dev", projectId: "project-a" },
      { id: "tenancy-b-main", projectId: "project-b" },
      { id: "tenancy-c-main", projectId: "project-c" },
      { id: "tenancy-d-main", projectId: "project-d" },
    ],
    projectUsers: [
      { tenancyId: "tenancy-a-main", isAnonymous: false },
      { tenancyId: "tenancy-a-main", isAnonymous: true },
      { tenancyId: "tenancy-a-dev", isAnonymous: false },
      { tenancyId: "tenancy-b-main", isAnonymous: false },
      { tenancyId: "tenancy-c-main", isAnonymous: false },
      { tenancyId: "tenancy-d-main", isAnonymous: false },
    ],
  });

  it("lists only projects owned by billing team", async () => {
    const projectIds = await getOwnedProjectIdsForBillingTeam("team-1", globalPrisma);
    expect(projectIds).toEqual(["project-a", "project-b"]);
  });

  it("lists all tenancies for projects owned by billing team", async () => {
    const tenancyIds = await getOwnedTenancyIdsForBillingTeam("team-1", globalPrisma);
    expect(tenancyIds).toEqual(["tenancy-a-main", "tenancy-a-dev", "tenancy-b-main"]);
  });

  it("counts only non-anonymous users across all owned tenancies", async () => {
    const usage = await getTeamWideNonAnonymousUserCount("team-1", globalPrisma);
    expect(usage).toBe(3);
  });

  it("returns zero usage for team with no projects", async () => {
    const emptyGlobalPrisma = createGlobalPrismaStub({
      projects: [],
      tenancies: [],
      projectUsers: [],
    });
    const usage = await getTeamWideNonAnonymousUserCount("team-does-not-own-projects", emptyGlobalPrisma);
    expect(usage).toBe(0);
  });
});

describe("capacity lookup helpers", () => {
  const billingTeamId = "team-free";

  const itemLimits = new Map<string, number>([
    [ITEM_IDS.authUsers, PLAN_LIMITS.free.authUsers],
    [ITEM_IDS.seats, PLAN_LIMITS.free.seats],
  ]);

  const capacityReaders = {
    getPrismaForTenancy: async (): Promise<PrismaClientTransaction> => ({} as PrismaClientTransaction),
    getItemQuantityForCustomer: async (options: {
      prisma: unknown,
      tenancyId: string,
      customerId: string,
      customerType: "team",
      itemId: string,
    }) => {
      if (options.customerId !== billingTeamId) {
        throw new Error("Unexpected billing team");
      }
      return itemLimits.get(options.itemId) ?? 0;
    },
  };

  it("returns free auth user capacity", async () => {
    const capacity = await getTeamWideItemCapacityForTests(
      billingTeamId,
      ITEM_IDS.authUsers,
      capacityReaders,
    );
    expect(capacity).toBe(PLAN_LIMITS.free.authUsers);
  });

  it("returns the same auth capacity for two project tenancies of one team", async () => {
    const capacityA = await getTeamWideItemCapacityForTests(
      billingTeamId,
      ITEM_IDS.authUsers,
      capacityReaders,
    );
    const capacityB = await getTeamWideItemCapacityForTests(
      billingTeamId,
      ITEM_IDS.authUsers,
      capacityReaders,
    );
    expect(capacityA).toBe(PLAN_LIMITS.free.authUsers);
    expect(capacityB).toBe(PLAN_LIMITS.free.authUsers);
  });

  it("maps seats capacity helper to seats plan item", async () => {
    const seatsCapacity = await getTeamWideItemCapacityForTests(
      billingTeamId,
      ITEM_IDS.seats,
      capacityReaders,
    );
    expect(seatsCapacity).toBe(PLAN_LIMITS.free.seats);
  });

  it("throws on unknown item id", async () => {
    await expect(getTeamWideItemCapacityForTests(
      billingTeamId,
      "unknown_item",
      capacityReaders,
    )).rejects.toThrow("Unsupported team-wide capacity item id");
  });

  it("rejects emails_per_month as unsupported capacity item (handled via SDK)", async () => {
    await expect(getTeamWideItemCapacityForTests(
      billingTeamId,
      ITEM_IDS.emailsPerMonth,
      capacityReaders,
    )).rejects.toThrow("Unsupported team-wide capacity item id");
  });
});
