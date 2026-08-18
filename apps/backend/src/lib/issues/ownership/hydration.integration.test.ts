import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { IssueOwnerSource, IssueOwnerType } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hydrateIssueAlertOwnership } from "./hydration";

const runPrefix = `ownership-hydration-${randomUUID()}`;
const issueCreatedAt = new Date("2026-08-06T12:00:00.000Z");

let tenancy: Tenancy;
let issueId: string;
let currentUserId: string;
let otherBranchUserId: string;
let teamId: string;

beforeAll(async () => {
  // Deliberately NOT the internal tenancy: the ownership resolver rejects
  // member snapshots above OWNERSHIP_RESOLVER_MAX_MEMBERS (512) by design, and
  // a seeded dev database gives the internal project 1000+ users — which turns
  // every hydration into the over-limit rejection instead of exercising the
  // routing under test. Any small tenancy works; the fixture creates its own
  // users, team, and issue inside it.
  const tenancyRows = await globalPrismaClient.tenancy.findMany({
    where: { projectId: { not: "internal" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  let picked: Tenancy | null = null;
  for (const row of tenancyRows) {
    const memberCount = await globalPrismaClient.projectUser.count({ where: { tenancyId: row.id } });
    if (memberCount > 400) continue;
    const resolved = await getTenancy(row.id);
    if (resolved === null) continue;
    picked = resolved;
    break;
  }
  if (picked === null) throw new Error("Ownership hydration tests need a seeded tenancy with fewer than 400 users.");
  tenancy = picked;
  issueId = randomUUID();
  currentUserId = randomUUID();
  otherBranchUserId = randomUUID();
  teamId = randomUUID();

  const counter = await globalPrismaClient.issueCounter.upsert({
    where: { tenancyId: tenancy.id },
    create: { tenancyId: tenancy.id, nextShortId: 2n },
    update: { nextShortId: { increment: 1 } },
    select: { nextShortId: true },
  });
  await globalPrismaClient.issue.create({
    data: {
      id: issueId,
      tenancyId: tenancy.id,
      shortId: counter.nextShortId - 1n,
      type: "OwnershipHydrationIntegrationError",
      value: `${runPrefix}-issue`,
      culprit: "hydration.integration.test.ts",
      platform: "node",
      firstSeenAt: issueCreatedAt,
      lastSeenAt: issueCreatedAt,
    },
  });
  await globalPrismaClient.projectUser.createMany({
    data: [
      {
        tenancyId: tenancy.id,
        projectUserId: currentUserId,
        mirroredProjectId: tenancy.project.id,
        mirroredBranchId: tenancy.branchId,
      },
      {
        tenancyId: tenancy.id,
        projectUserId: otherBranchUserId,
        mirroredProjectId: tenancy.project.id,
        mirroredBranchId: `${tenancy.branchId}-other`,
      },
    ],
  });
  await globalPrismaClient.team.create({
    data: {
      tenancyId: tenancy.id,
      teamId,
      mirroredProjectId: tenancy.project.id,
      mirroredBranchId: tenancy.branchId,
      displayName: `${runPrefix}-team`,
    },
  });
  await globalPrismaClient.teamMember.create({
    data: { tenancyId: tenancy.id, projectUserId: currentUserId, teamId },
  });
  await globalPrismaClient.issueOwner.create({
    data: {
      tenancyId: tenancy.id,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      issueId,
      ownerType: IssueOwnerType.USER,
      ownerUserId: otherBranchUserId,
      source: IssueOwnerSource.OWNERSHIP_RULE,
    },
  });

  // Hydration deliberately reads membership through the read replica, and the
  // dev/CI replica is asynchronous with no replication-wait strategy — so a
  // read issued immediately after the seed writes above can legitimately miss
  // them. That staleness is acceptable for alert delivery in production, but
  // this fixture must not start until the replica has caught up, or the tests
  // race replication instead of testing hydration. (Skipped implicitly when no
  // replica is configured: $replica() then falls back to the primary.)
  const replicaDeadline = performance.now() + 30_000;
  while (true) {
    const replicatedMember = await globalPrismaClient.$replica().teamMember.findFirst({
      where: { tenancyId: tenancy.id, teamId, projectUserId: currentUserId },
      select: { projectUserId: true },
    });
    const replicatedOwner = await globalPrismaClient.$replica().issueOwner.findFirst({
      where: { tenancyId: tenancy.id, issueId },
      select: { id: true },
    });
    if (replicatedMember !== null && replicatedOwner !== null) break;
    if (performance.now() > replicaDeadline) {
      throw new Error("The read replica did not catch up with the seeded ownership fixtures within 30s");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

afterAll(async () => {
  await globalPrismaClient.issueOwner.deleteMany({ where: { tenancyId: tenancy.id, issueId } });
  await globalPrismaClient.teamMember.deleteMany({ where: { tenancyId: tenancy.id, teamId } });
  await globalPrismaClient.team.deleteMany({ where: { tenancyId: tenancy.id, teamId } });
  await globalPrismaClient.projectUser.deleteMany({
    where: { tenancyId: tenancy.id, projectUserId: { in: [currentUserId, otherBranchUserId] } },
  });
  await globalPrismaClient.issue.deleteMany({ where: { tenancyId: tenancy.id, id: issueId } });
});

describe("database-backed ownership hydration", () => {
  it("reads a scoped team snapshot through the replica and expands it", async () => {
    const result = await hydrateIssueAlertOwnership(tenancy, issueId, { type: "team", teamId });

    expect(result.recipients).toEqual([{ userId: currentUserId }]);
    expect(result.metadata).toMatchObject({
      target: { type: "team", team_id: teamId },
      status: "resolved",
      reason: "target_resolved",
      recipient_count: 1,
    });
  });

  it("falls through an owner outside the current branch to active members and supports empty routes", async () => {
    const fallthrough = await hydrateIssueAlertOwnership(tenancy, issueId, {
      type: "issue_owners",
      fallthrough: "active_members",
    });
    expect(fallthrough.recipients).toContainEqual({ userId: currentUserId });
    expect(fallthrough.recipients).not.toContainEqual({ userId: otherBranchUserId });
    expect(fallthrough.metadata.recipient_count).toBe(fallthrough.recipients.length);
    expect(fallthrough.metadata.reason).toBe("fallthrough_resolved");

    const empty = await hydrateIssueAlertOwnership(tenancy, randomUUID(), {
      type: "issue_owners",
      fallthrough: "none",
    });
    expect(empty.recipients).toEqual([]);
    expect(empty.metadata).toMatchObject({ status: "empty", reason: "no_recipient", recipient_count: 0 });
  });
});
