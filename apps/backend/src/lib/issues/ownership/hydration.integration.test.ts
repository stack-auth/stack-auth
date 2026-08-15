import { getSoleTenancyFromProjectBranch, DEFAULT_BRANCH_ID, type Tenancy } from "@/lib/tenancies";
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
  tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
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
