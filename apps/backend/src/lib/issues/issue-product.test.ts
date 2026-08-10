import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addIssueComment,
  appendIssueActivity,
  listIssueActivity,
  loadIssueProductSnapshot,
  setIssueBookmark,
  setIssueOwner,
  setIssuePriority,
  setIssueSubscription,
} from "./issue-product";
import { assignIssueToTeam } from "./issue-lifecycle";

let tenancy: Tenancy;
let issueId: string;
let userId: string;
let otherUserId: string;
let teamId: string;

beforeAll(async () => {
  const tenancyRow = await globalPrismaClient.tenancy.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (tenancyRow === null) throw new Error("Issue product tests need a seeded tenancy.");
  const resolved = await getTenancy(tenancyRow.id);
  if (resolved === null) throw new Error("Issue product test tenancy disappeared.");
  tenancy = resolved;
  const prisma = await getPrismaClientForTenancy(tenancy);
  const users = await prisma.projectUser.findMany({ where: { tenancyId: tenancy.id }, select: { projectUserId: true }, take: 2 });
  const user = users.at(0);
  const otherUser = users.at(1);
  const team = await prisma.team.findFirst({ where: { tenancyId: tenancy.id }, select: { teamId: true } });
  if (user === undefined || otherUser === undefined || team === null) throw new Error("Issue product tests need two users and one team in the seeded branch.");
  userId = user.projectUserId;
  otherUserId = otherUser.projectUserId;
  teamId = team.teamId;
  const [{ shortId }] = await prisma.$queryRaw<Array<{ shortId: bigint }>>`
    INSERT INTO "IssueCounter" ("tenancyId", "nextShortId")
    VALUES (${tenancy.id}::uuid, 2::bigint)
    ON CONFLICT ("tenancyId") DO UPDATE SET "nextShortId" = "IssueCounter"."nextShortId" + 1
    RETURNING "nextShortId" - 1 AS "shortId"
  `;
  issueId = randomUUID();
  const seenAt = new Date("2026-08-06T12:00:00.000Z");
  await prisma.issue.create({ data: { id: issueId, tenancyId: tenancy.id, shortId, type: "TypeError", value: `issue-product-${issueId}`, culprit: "issue-product.test.ts", platform: "javascript", firstSeenAt: seenAt, lastSeenAt: seenAt, timesSeen: 1n } });
});

afterAll(async () => {
  const prisma = await getPrismaClientForTenancy(tenancy);
  await prisma.issue.delete({ where: { tenancyId_id: { tenancyId: tenancy.id, id: issueId } } });
});

describe("durable issue product metadata", () => {
  it("persists priority, team assignment, owner, comment, subscription, bookmark, and activity state", async () => {
    const at = new Date("2026-08-06T12:01:00.000Z");
    await expect(setIssuePriority({ tenancy, issueId, priority: "high", actorUserId: userId, occurredAt: at })).resolves.toMatchObject({ previousPriority: null, priority: "high", changed: true });
    await expect(assignIssueToTeam({ tenancy, issueId, teamId, actorUserId: userId, changedAt: at })).resolves.toMatchObject({ previousTeamId: null, teamId, changed: true });
    const comment = await addIssueComment({ tenancy, issueId, actorUserId: userId, body: "Investigating the next release.", idempotencyKey: "comment-issue-product-1", occurredAt: at });
    await expect(addIssueComment({ tenancy, issueId, actorUserId: userId, body: "Investigating the next release.", idempotencyKey: "comment-issue-product-1", occurredAt: at })).resolves.toMatchObject({ id: comment.id });
    await expect(setIssueSubscription({ tenancy, issueId, subject: { type: "user", id: otherUserId }, subscribed: true, reason: "manual", actorUserId: userId, idempotencyKey: "subscription-issue-product-1", occurredAt: at })).resolves.toMatchObject({ type: "user", id: otherUserId, isActive: true });
    await expect(setIssueSubscription({ tenancy, issueId, subject: { type: "user", id: otherUserId }, subscribed: false, reason: "manual", actorUserId: userId, idempotencyKey: "subscription-issue-product-2", occurredAt: new Date(at.getTime() + 1) })).resolves.toMatchObject({ isActive: false });
    await expect(setIssueBookmark({ tenancy, issueId, userId: otherUserId, bookmarked: true, actorUserId: userId, idempotencyKey: "bookmark-issue-product-1", occurredAt: at })).resolves.toMatchObject({ bookmarked: true, changed: true });
    await expect(setIssueBookmark({ tenancy, issueId, userId: otherUserId, bookmarked: false, actorUserId: userId, idempotencyKey: "bookmark-issue-product-2", occurredAt: new Date(at.getTime() + 2) })).resolves.toMatchObject({ bookmarked: false, changed: true });
    await expect(setIssueOwner({ tenancy, issueId, owner: { type: "user", userId: otherUserId, source: "manual", context: { rule: "test" } }, actorUserId: userId, occurredAt: at })).resolves.toMatchObject({ type: "user", userId: otherUserId, source: "manual" });
    await expect(appendIssueActivity({ tenancy, issueId, type: "regressed", actorUserId: null, idempotencyKey: "activity-issue-product-1", data: { received_at: at.toISOString() }, occurredAt: at })).resolves.toMatchObject({ type: "regressed" });

    const snapshot = await loadIssueProductSnapshot({ tenancy, issueId });
    expect(snapshot).toMatchObject({ priority: "high", teamId, assigneeUserId: null });
    expect(snapshot.comments).toHaveLength(1);
    expect(snapshot.subscriptions).toEqual(expect.arrayContaining([expect.objectContaining({ id: otherUserId, isActive: false })]));
    expect(snapshot.owners).toEqual(expect.arrayContaining([expect.objectContaining({ userId: otherUserId, source: "manual" })]));
    expect(snapshot.bookmarkedUserIds).not.toContain(otherUserId);
    expect((await listIssueActivity({ tenancy, issueId, limit: 100 })).length).toBeGreaterThanOrEqual(6);
  });

  it("rejects malformed ownership and cross-branch issue access", async () => {
    await expect(setIssueOwner({ tenancy, issueId, owner: { type: "user", teamId, source: "manual" } })).rejects.toThrow(/requires only userId/);
    await expect(loadIssueProductSnapshot({ tenancy, issueId: randomUUID() })).rejects.toThrow(/not found/);
  });
});
