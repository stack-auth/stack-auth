import { EmailOutboxCreatedWith, Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { afterAll, describe, expect, it } from "vitest";
import { _forTesting } from "./email-queue-step";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "./tenancies";

const { failEmailsStuckInSending, STUCK_EMAIL_TIMEOUT_MS } = _forTesting;

// These tests connect to the real dev DB (like payments.test.tsx) and create real EmailOutbox
// rows against the seeded `internal` tenancy. Each row is tagged with a unique tsxSource so we
// can find and clean up just our test rows.
describe.sequential("failEmailsStuckInSending", () => {
  const testRunTag = `stuck-in-sending-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdIds: { tenancyId: string, id: string }[] = [];

  const recoveryTestFilter = { tsxSource: `/* ${testRunTag} */` };

  const makeRow = async (params: {
    startedSendingAt: Date | null,
    finishedSendingAt?: Date | null,
    isPaused?: boolean,
    sendRetries?: number,
    nextSendRetryAt?: Date | null,
  }) => {
    const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
    const id = generateUuid();
    await globalPrismaClient.$executeRaw(Prisma.sql`
      INSERT INTO "EmailOutbox" (
        "tenancyId",
        "id",
        "createdAt",
        "updatedAt",
        "tsxSource",
        "themeId",
        "isHighPriority",
        "to",
        "extraRenderVariables",
        "shouldSkipDeliverabilityCheck",
        "createdWith",
        "scheduledAt",
        "isQueued",
        "renderedByWorkerId",
        "startedRenderingAt",
        "finishedRenderingAt",
        "renderedHtml",
        "renderedText",
        "renderedSubject",
        "renderedIsTransactional",
        "startedSendingAt",
        "finishedSendingAt",
        "sendRetries",
        "nextSendRetryAt",
        "isPaused"
      )
      VALUES (
        ${tenancy.id}::uuid,
        ${id}::uuid,
        NOW(),
        NOW(),
        ${recoveryTestFilter.tsxSource},
        NULL,
        FALSE,
        ${JSON.stringify({ type: "custom-emails", emails: ["stuck-test@example.com"] })}::jsonb,
        ${JSON.stringify({})}::jsonb,
        TRUE,
        ${EmailOutboxCreatedWith.PROGRAMMATIC_CALL}::"EmailOutboxCreatedWith",
        ${new Date(0)},
        TRUE,
        ${"00000000-0000-0000-0000-000000000000"}::uuid,
        ${new Date(0)},
        ${new Date(0)},
        ${"<p>stuck</p>"},
        ${"stuck"},
        ${"stuck"},
        FALSE,
        ${params.startedSendingAt},
        ${params.finishedSendingAt ?? null},
        ${params.sendRetries ?? 0},
        ${params.nextSendRetryAt ?? null},
        ${params.isPaused ?? false}
      )
    `);
    const created = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: tenancy.id, id } },
    });
    createdIds.push({ tenancyId: created.tenancyId, id: created.id });
    return created;
  };

  afterAll(async () => {
    for (const { tenancyId, id } of createdIds) {
      await globalPrismaClient.emailOutbox.deleteMany({ where: { tenancyId, id } });
    }
  });

  it("marks a row as failed when startedSendingAt is older than the stuck timeout", async () => {
    const longAgo = new Date(Date.now() - STUCK_EMAIL_TIMEOUT_MS - 60_000);
    const row = await makeRow({
      startedSendingAt: longAgo,
      sendRetries: 1,
      nextSendRetryAt: new Date(Date.now() + 60_000),
    });

    await failEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.finishedSendingAt).not.toBeNull();
    expect(after.startedSendingAt?.toISOString()).toBe(row.startedSendingAt?.toISOString());
    expect(after.canHaveDeliveryInfo).toBe(false);
    expect(after.sendServerErrorExternalMessage).toMatch(/timed out/i);
    expect(after.sendServerErrorInternalMessage).toMatch(/stuck in sending/i);
    expect(after.sendServerErrorInternalMessage).toMatch(/terminal server error/i);
    // Must be a terminal state — no retry scheduled.
    expect(after.nextSendRetryAt).toBeNull();
    // sendRetries is not bumped by this path (we never attempted the send again).
    expect(after.sendRetries).toBe(row.sendRetries);
    // Status must be SERVER_ERROR, not SENDING.
    expect(after.status).toBe("SERVER_ERROR");
  });

  it("does not touch a row that started sending recently", async () => {
    const recently = new Date(Date.now() - 1000);
    const row = await makeRow({ startedSendingAt: recently });

    await failEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.finishedSendingAt).toBeNull();
    expect(after.sendServerErrorExternalMessage).toBeNull();
    expect(after.status).toBe("SENDING");
  });

  it("does not re-queue rows already marked failed for another send attempt", async () => {
    const longAgo = new Date(Date.now() - STUCK_EMAIL_TIMEOUT_MS - 60_000);
    const row = await makeRow({ startedSendingAt: longAgo });

    await failEmailsStuckInSending(recoveryTestFilter);
    // A second pass should be a no-op for this row: it's already terminal, so it must not
    // become a candidate for re-sending (which could duplicate an already-accepted delivery).
    await failEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.nextSendRetryAt).toBeNull();
    expect(after.isQueued).toBe(true); // unchanged: we do not unclaim stuck rows
    expect(after.status).toBe("SERVER_ERROR");
  });
});
