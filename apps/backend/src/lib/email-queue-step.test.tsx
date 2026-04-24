import { EmailOutboxCreatedWith } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { afterAll, describe, expect, it } from "vitest";
import { _forTesting } from "./email-queue-step";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "./tenancies";

const { recoverEmailsStuckInSending, STUCK_EMAIL_TIMEOUT_MS } = _forTesting;

// These tests connect to the real dev DB (like payments.test.tsx) and create real EmailOutbox
// rows against the seeded `internal` tenancy. Each row is tagged with a unique tsxSource so we
// can find and clean up just our test rows.
describe.sequential("recoverEmailsStuckInSending", () => {
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
    const created = await globalPrismaClient.emailOutbox.create({
      data: {
        tenancyId: tenancy.id,
        tsxSource: recoveryTestFilter.tsxSource,
        themeId: null,
        isHighPriority: false,
        to: { type: "custom-emails", emails: ["stuck-test@example.com"] },
        extraRenderVariables: {},
        shouldSkipDeliverabilityCheck: true,
        createdWith: EmailOutboxCreatedWith.PROGRAMMATIC_CALL,
        scheduledAt: new Date(0),
        isQueued: true,
        renderedByWorkerId: "00000000-0000-0000-0000-000000000000",
        startedRenderingAt: new Date(0),
        finishedRenderingAt: new Date(0),
        renderedHtml: "<p>stuck</p>",
        renderedText: "stuck",
        renderedSubject: "stuck",
        renderedIsTransactional: false,
        startedSendingAt: params.startedSendingAt,
        finishedSendingAt: params.finishedSendingAt ?? null,
        sendRetries: params.sendRetries ?? 0,
        nextSendRetryAt: params.nextSendRetryAt ?? null,
        isPaused: params.isPaused ?? false,
      },
    });
    createdIds.push({ tenancyId: created.tenancyId, id: created.id });
    return created;
  };

  afterAll(async () => {
    for (const { tenancyId, id } of createdIds) {
      await globalPrismaClient.emailOutbox.deleteMany({ where: { tenancyId, id } });
    }
  });

  it("recovers a row whose startedSendingAt is older than the stuck timeout", async () => {
    const longAgo = new Date(Date.now() - STUCK_EMAIL_TIMEOUT_MS - 60_000);
    const row = await makeRow({
      startedSendingAt: longAgo,
      sendRetries: 1,
      nextSendRetryAt: new Date(Date.now() + 60_000),
    });

    await recoverEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.finishedSendingAt).not.toBeNull();
    expect(after.startedSendingAt?.toISOString()).toBe(row.startedSendingAt?.toISOString());
    expect(after.canHaveDeliveryInfo).toBe(false);
    expect(after.sendServerErrorExternalMessage).toMatch(/timed out/i);
    expect(after.sendServerErrorInternalMessage).toMatch(/stuck in sending/i);
    // Must be a terminal state — no retry scheduled.
    expect(after.nextSendRetryAt).toBeNull();
    // sendRetries is not bumped by recovery (we never attempted the send again).
    expect(after.sendRetries).toBe(row.sendRetries);
    // Status must be SERVER_ERROR, not SENDING.
    expect(after.status).toBe("SERVER_ERROR");
  });

  it("does not touch a row that started sending recently", async () => {
    const recently = new Date(Date.now() - 1000);
    const row = await makeRow({ startedSendingAt: recently });

    await recoverEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.finishedSendingAt).toBeNull();
    expect(after.sendServerErrorExternalMessage).toBeNull();
    expect(after.status).toBe("SENDING");
  });

  it("does not re-queue recovered rows for another send attempt", async () => {
    const longAgo = new Date(Date.now() - STUCK_EMAIL_TIMEOUT_MS - 60_000);
    const row = await makeRow({ startedSendingAt: longAgo });

    await recoverEmailsStuckInSending(recoveryTestFilter);
    // A second pass should be a no-op for this row: it's already terminal, so it must not
    // become a candidate for re-sending (which could duplicate an already-accepted delivery).
    await recoverEmailsStuckInSending(recoveryTestFilter);

    const after = await globalPrismaClient.emailOutbox.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: row.tenancyId, id: row.id } },
    });
    expect(after.nextSendRetryAt).toBeNull();
    expect(after.isQueued).toBe(true); // unchanged: we do not unclaim stuck rows
    expect(after.status).toBe("SERVER_ERROR");
  });
});
