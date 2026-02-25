import { EmailOutbox, EmailOutboxSkippedReason, Prisma } from "@/generated/prisma/client";
import { calculateCapacityRate, getEmailCapacityBoostExpiresAt, getEmailDeliveryStatsForTenancy } from "@/lib/email-delivery-stats";
import { getEmailThemeForThemeId, renderEmailsForTenancyBatched } from "@/lib/email-rendering";
import { EmailOutboxRecipient, getEmailConfig, } from "@/lib/emails";
import { generateUnsubscribeLink, getNotificationCategoryById, hasNotificationEnabled, listNotificationCategories } from "@/lib/notification-categories";
import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, PrismaClientTransaction } from "@/prisma-client";
import { withTraceSpan } from "@/utils/telemetry";
import { allPromisesAndWaitUntilEach } from "@/utils/vercel";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { getEnvBoolean, getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, errorToNiceString, StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";
import { randomUUID } from "node:crypto";
import { lowLevelSendEmailDirectWithoutRetries } from "./emails-low-level";

const MAX_RENDER_BATCH = 50;

const MAX_SEND_ATTEMPTS = 5;

const SEND_RETRY_BACKOFF_BASE_MS = 20000;

const calculateRetryBackoffMs = (attemptCount: number): number => {
  return (Math.random() + 0.5) * SEND_RETRY_BACKOFF_BASE_MS * Math.pow(2, attemptCount);
};

/**
 * Structure for tracking errors from each send attempt.
 * Mirrors the pattern used for sendServerError* fields.
 * Uses Prisma.InputJsonValue-compatible types for DB storage.
 */
type SendAttemptError = {
  attemptNumber: number,
  timestamp: string,
  externalMessage: string,
  externalDetails: Prisma.InputJsonObject,
  internalMessage: string,
  internalDetails: Prisma.InputJsonObject,
};

const appendSendAttemptError =(
  existingErrors: SendAttemptError[] | null | undefined,
  newError: SendAttemptError
): SendAttemptError[] => {
  const errors = existingErrors ?? [];
  return [...errors, newError];
};

// Track if email queue has run at least once since server start (used to suppress first-run delta warnings in dev)
const emailQueueFirstRunKey = Symbol.for("__stack_email_queue_first_run_completed");

type EmailableVerificationResult =
  | { status: "ok" }
  | { status: "not-deliverable", emailableResponse: Record<string, unknown> };

/**
 * Verifies email deliverability using the Emailable API.
 *
 * If STACK_EMAILABLE_API_KEY is set, it calls the Emailable API to verify the email.
 * If the API key is not set, it falls back to a default behavior where emails
 * with the domain "emailable-not-deliverable.example.com" are rejected (for testing).
 */
async function verifyEmailDeliverability(
  email: string,
  shouldSkipDeliverabilityCheck: boolean,
  emailConfigType: "shared" | "standard"
): Promise<EmailableVerificationResult> {
  // Skip deliverability check if requested or using non-shared email config
  if (shouldSkipDeliverabilityCheck || emailConfigType !== "shared") {
    return { status: "ok" };
  }

  const emailableApiKey = getEnvVariable("STACK_EMAILABLE_API_KEY", "");

  if (emailableApiKey) {
    // Use Emailable API for verification
    return await traceSpan("verifying email address with Emailable", async () => {
      try {
        const emailableResponseResult = await Result.retry(async () => {
          const res = await fetch(
            `https://api.emailable.com/v1/verify?email=${encodeURIComponent(email)}&api_key=${emailableApiKey}`
          );
          if (res.status === 249) {
            const text = await res.text();
            console.log("Emailable is taking longer than expected, retrying...", text, { email });
            return Result.error(
              new Error(
                `Emailable API returned a 249 error for ${email}. This means it takes some more time to verify the email address. Response body: ${text}`
              )
            );
          }
          return Result.ok(res);
        }, 4, { exponentialDelayBase: 4000 });

        if (emailableResponseResult.status === "error") {
          throw new StackAssertionError("Timed out while verifying email address with Emailable", {
            email,
            emailableResponseResult,
          });
        }

        const emailableResponse = emailableResponseResult.data;
        if (!emailableResponse.ok) {
          throw new StackAssertionError("Failed to verify email address with Emailable", {
            email,
            emailableResponse,
            emailableResponseText: await emailableResponse.text(),
          });
        }

        const json = await emailableResponse.json() as Record<string, unknown>;

        if (json.state === "undeliverable" || json.disposable) {
          console.log("email not deliverable", email, json);
          return { status: "not-deliverable", emailableResponse: json };
        }

        return { status: "ok" };
      } catch (error) {
        // If something goes wrong with the Emailable API (eg. 500, ran out of credits, etc.), we just send the email anyway
        captureError("emailable-api-error", error);
        return { status: "ok" };
      }
    });
  } else {
    // Fallback behavior when no API key is set: reject test domain for testing purposes, and accept everything else
    const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (emailDomain === EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN) {
      return {
        status: "not-deliverable",
        emailableResponse: {
          state: "undeliverable",
          reason: "test_domain_rejection",
          message: `Emails to ${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN} are rejected in test mode when STACK_EMAILABLE_API_KEY is not set`,
        },
      };
    }
    return { status: "ok" };
  }
}

type TenancySendBatch = {
  tenancyId: string,
  rows: EmailOutbox[],
  capacityRatePerSecond: number,
};

// note: there is no locking surrounding this function, so it may run multiple times concurrently. It needs to deal with that.
export const runEmailQueueStep = withTraceSpan("runEmailQueueStep", async () => {
  const start = performance.now();
  const workerId = randomUUID();

  const deltaSeconds = await withTraceSpan("runEmailQueueStep-updateLastExecutionTime", updateLastExecutionTime)();
  const updateLastExecutionTimeEnd = performance.now();


  const pendingRender = await withTraceSpan("runEmailQueueStep-claimEmailsForRendering", claimEmailsForRendering)(workerId);
  await withTraceSpan("runEmailQueueStep-renderEmails", renderEmails)(workerId, pendingRender);
  await withTraceSpan("runEmailQueueStep-retryEmailsStuckInRendering", retryEmailsStuckInRendering)();
  const renderingEnd = performance.now();

  const { queuedCount } = await withTraceSpan("runEmailQueueStep-queueReadyEmails", queueReadyEmails)();
  const queueReadyEnd = performance.now();

  const sendPlan = await withTraceSpan("runEmailQueueStep-prepareSendPlan", prepareSendPlan)(deltaSeconds);
  await withTraceSpan("runEmailQueueStep-processSendPlan", processSendPlan)(sendPlan);
  await withTraceSpan("runEmailQueueStep-logEmailsStuckInSending", logEmailsStuckInSending)();
  const sendEnd = performance.now();

  if (sendPlan.length > 0 || queuedCount > 0 || pendingRender.length > 0) {
    const timings = {
      meta: updateLastExecutionTimeEnd - start,
      render: renderingEnd - updateLastExecutionTimeEnd,
      queue: queueReadyEnd - renderingEnd,
      send: sendEnd - queueReadyEnd,
    };
    console.log(`Rendered ${pendingRender.length} emails, queued ${queuedCount} emails, and sent emails from ${sendPlan.length} tenancies in ${(sendEnd - start).toFixed(1)}ms (${Object.entries(timings).map(([key, value]) => `${key}: ${value.toFixed(1)}ms`).join(", ")}, worker: ${workerId})`);
  }
});

async function retryEmailsStuckInRendering(): Promise<void> {
  const res = await globalPrismaClient.emailOutbox.updateManyAndReturn({
    where: {
      startedRenderingAt: {
        lte: new Date(Date.now() - 1000 * 60 * 20),
      },
      finishedRenderingAt: null,
      skippedReason: null,
      isPaused: false,
    },
    data: {
      renderedByWorkerId: null,
      startedRenderingAt: null,
    },
  });
  if (res.length > 0) {
    captureError("email-queue-step-stuck-in-rendering", new StackAssertionError(`${res.length} emails stuck in rendering! This should never happen. Resetting them to be re-rendered.`, {
      emails: res.map(e => e.id),
    }));
  }
}

async function logEmailsStuckInSending(): Promise<void> {
  const res = await globalPrismaClient.emailOutbox.findMany({
    where: {
      startedSendingAt: {
        lte: new Date(Date.now() - 1000 * 60 * 20),
      },
      finishedSendingAt: null,
      skippedReason: null,
      isPaused: false,
    },
    select: { id: true, tenancyId: true, startedSendingAt: true },
  });
  if (res.length > 0) {
    captureError("email-queue-step-stuck-in-sending", new StackAssertionError(`${res.length} emails stuck in sending! This should never happen. It was NOT correctly marked as an error! Manual intervention is required.`, {
      emails: res.map(e => ({ id: e.id, tenancyId: e.tenancyId, startedSendingAt: e.startedSendingAt })),
    }));
  }
}

async function updateLastExecutionTime(): Promise<number> {
  const key = "EMAIL_QUEUE_METADATA_KEY";

  // This query atomically claims the next execution slot and returns the delta.
  // It uses FOR UPDATE to lock the row, preventing concurrent workers from reading
  // the same previous timestamp. The pattern is:
  // 1. Try UPDATE first (locks row with FOR UPDATE, returns old and new timestamps)
  // 2. If no row exists, INSERT (with ON CONFLICT DO NOTHING for race handling)
  // 3. Compute delta based on the result
  const [{ delta }] = await globalPrismaClient.$queryRaw<{ delta: number }[]>`
    WITH now_ts AS (
      SELECT NOW() AS now
    ),
    do_update AS (
      -- Update existing row, locking it first and capturing the old timestamp
      UPDATE "EmailOutboxProcessingMetadata" AS m
      SET 
        "updatedAt" = (SELECT now FROM now_ts),
        "lastExecutedAt" = (SELECT now FROM now_ts)
      FROM (
        SELECT "key", "lastExecutedAt" AS previous_timestamp
      FROM "EmailOutboxProcessingMetadata"
      WHERE "key" = ${key}
        FOR UPDATE
      ) AS old
      WHERE m."key" = old."key"
      RETURNING old.previous_timestamp, m."lastExecutedAt" AS new_timestamp
    ),
    do_insert AS (
      -- Insert new row if no existing row was updated
      INSERT INTO "EmailOutboxProcessingMetadata" ("key", "lastExecutedAt", "updatedAt")
      SELECT ${key}, (SELECT now FROM now_ts), (SELECT now FROM now_ts)
      WHERE NOT EXISTS (SELECT 1 FROM do_update)
      ON CONFLICT ("key") DO NOTHING
      RETURNING NULL::timestamp AS previous_timestamp, "lastExecutedAt" AS new_timestamp
    ),
    result AS (
      SELECT * FROM do_update
      UNION ALL
      SELECT * FROM do_insert
    )
    SELECT
      CASE
        -- Concurrent insert race: another worker just inserted, skip this run
        WHEN NOT EXISTS (SELECT 1 FROM result) THEN 0.0
        -- First run (inserted new row), use reasonable default delta
        WHEN (SELECT previous_timestamp FROM result) IS NULL THEN 20.0
        -- Normal update case: compute actual delta
        ELSE EXTRACT(EPOCH FROM 
          (SELECT new_timestamp FROM result) - 
          (SELECT previous_timestamp FROM result)
        )
    END AS delta;
  `;

  if (delta < 0) {
    // TODO: why does this happen, actually? investigate.
    console.warn("Email queue step delta is negative. Not sure why it happened. Ignoring the delta. TODO investigate", { delta });
    return 0;
  }

  if (delta > 30) {
    const isFirstRun = !(globalThis as any)[emailQueueFirstRunKey];
    if (isFirstRun && getNodeEnvironment() === "development") {
      // In development, the first run after server start often has a large delta because the server wasn't running
      console.log(`[email-queue] Skipping delta warning on first run (delta: ${delta.toFixed(2)}s) — this is normal after server restart`);
    } else {
      captureError("email-queue-step-delta-too-large", new StackAssertionError(`Email queue step delta is too large: ${delta}. Either the previous step took too long, or something is wrong.`));
    }
  }
  (globalThis as any)[emailQueueFirstRunKey] = true;

  return delta;
}

async function claimEmailsForRendering(workerId: string): Promise<EmailOutbox[]> {
  return await globalPrismaClient.$queryRaw<EmailOutbox[]>(Prisma.sql`
    WITH selected AS (
      SELECT "tenancyId", "id"
      FROM "EmailOutbox"
      WHERE "renderedByWorkerId" IS NULL
        AND "isPaused" = FALSE
      ORDER BY "createdAt" ASC
      LIMIT ${MAX_RENDER_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EmailOutbox" AS e
    SET
      "renderedByWorkerId" = ${workerId}::uuid,
      "startedRenderingAt" = NOW()
    FROM selected
    WHERE e."tenancyId" = selected."tenancyId" AND e."id" = selected."id"
    RETURNING e.*;
  `);
}

async function renderEmails(workerId: string, rows: EmailOutbox[]): Promise<void> {
  const rowsByTenancy = groupBy(rows, outbox => outbox.tenancyId);

  for (const [tenancyId, group] of rowsByTenancy.entries()) {
    try {
      await renderTenancyEmails(workerId, tenancyId, group);
    } catch (error) {
      captureError("email-queue-step-rendering-error", error);
    }
  }
}

async function renderTenancyEmails(workerId: string, tenancyId: string, group: EmailOutbox[]): Promise<void> {
  const tenancy = await getTenancy(tenancyId) ?? throwErr("Tenancy not found in renderTenancyEmails? Was the tenancy deletion not cascaded?");
  const prisma = await getPrismaClientForTenancy(tenancy);

  // Prefetch all users referenced in the group
  const userIds = new Set<string>();
  for (const row of group) {
    const recipient = deserializeRecipient(row.to as Json);
    if ("userId" in recipient) {
      userIds.add(recipient.userId);
    }
  }
  const users = userIds.size > 0 ? await prisma.projectUser.findMany({
    where: { tenancyId: tenancy.id, projectUserId: { in: [...userIds] } },
    include: { contactChannels: true },
  }) : [];
  const userMap = new Map(users.map(user => [user.projectUserId, user]));

  const buildRenderRequest = (row: EmailOutbox, unsubscribeLink: string | undefined) => {
    const recipient = deserializeRecipient(row.to as Json);
    const userDisplayName = "userId" in recipient ? userMap.get(recipient.userId)?.displayName ?? null : null;
    return {
      templateSource: row.tsxSource,
      themeSource: getEmailThemeForThemeId(tenancy, row.themeId ?? false),
      input: {
        user: { displayName: userDisplayName },
        project: { displayName: tenancy.project.display_name },
        variables: filterUndefined({
          projectDisplayName: tenancy.project.display_name,
          userDisplayName: userDisplayName ?? "",
          ...filterUndefined((row.extraRenderVariables ?? {}) as Record<string, Json>),
        }),
        themeProps: {
          projectLogos: {
            logoUrl: tenancy.project.logo_url ?? undefined,
            logoFullUrl: tenancy.project.logo_full_url ?? undefined,
            logoDarkModeUrl: tenancy.project.logo_dark_mode_url ?? undefined,
            logoFullDarkModeUrl: tenancy.project.logo_full_dark_mode_url ?? undefined,
          }
        },
        unsubscribeLink,
      },
    };
  };

  const tryGenerateUnsubscribeLink = async (row: EmailOutbox, categoryId: string): Promise<string | undefined> => {
    const recipient = deserializeRecipient(row.to as Json);
    if (!("userId" in recipient)) return undefined;
    const category = getNotificationCategoryById(categoryId);
    if (!category?.can_disable) return undefined;
    const result = await Result.fromPromise(generateUnsubscribeLink(tenancy, recipient.userId, categoryId));
    if (result.status === "error") {
      captureError("generate-unsubscribe-link", result.error);
      return undefined;
    }
    return result.data;
  };

  const markRenderError = async (row: EmailOutbox, error: string) => {
    await globalPrismaClient.emailOutbox.updateMany({
      where: { tenancyId, id: row.id, renderedByWorkerId: workerId },
      data: {
        renderErrorExternalMessage: "An error occurred while rendering the email. Make sure the template/draft is valid and the theme is set correctly.",
        renderErrorExternalDetails: {},
        renderErrorInternalMessage: error,
        renderErrorInternalDetails: { error },
        finishedRenderingAt: new Date(),
      },
    });
  };

  const saveRenderedEmail = async (row: EmailOutbox, output: { html: string, text: string, subject?: string }, categoryId: string | undefined) => {
    const subject = row.overrideSubject ?? output.subject ?? "";
    const category = categoryId ? getNotificationCategoryById(categoryId) : undefined;
    await globalPrismaClient.emailOutbox.updateMany({
      where: { tenancyId, id: row.id, renderedByWorkerId: workerId },
      data: {
        renderedHtml: output.html,
        renderedText: output.text,
        renderedSubject: subject,
        renderedNotificationCategoryId: category?.id,
        renderedIsTransactional: category?.name === "Transactional",
        renderErrorExternalMessage: null,
        renderErrorExternalDetails: Prisma.DbNull,
        renderErrorInternalMessage: null,
        renderErrorInternalDetails: Prisma.DbNull,
        finishedRenderingAt: new Date(),
      },
    });
  };

  // Rows with overrideNotificationCategoryId can be rendered in one pass
  const rowsWithKnownCategory = group.filter(row => row.overrideNotificationCategoryId);
  if (rowsWithKnownCategory.length > 0) {
    const requests = await Promise.all(rowsWithKnownCategory.map(async (row) => {
      const unsubscribeLink = await tryGenerateUnsubscribeLink(row, row.overrideNotificationCategoryId!);
      return buildRenderRequest(row, unsubscribeLink);
    }));

    const result = await renderEmailsForTenancyBatched(requests);
    if (result.status === "error") {
      for (const row of rowsWithKnownCategory) {
        await markRenderError(row, result.error);
      }
    } else {
      for (let i = 0; i < rowsWithKnownCategory.length; i++) {
        await saveRenderedEmail(rowsWithKnownCategory[i], result.data[i], rowsWithKnownCategory[i].overrideNotificationCategoryId!);
      }
    }
  }

  // Rows without overrideNotificationCategoryId need two-pass rendering:
  // 1. First pass without unsubscribe link to determine the notification category
  // 2. Second pass with unsubscribe link if the category allows it
  const rowsWithUnknownCategory = group.filter(row => !row.overrideNotificationCategoryId);
  if (rowsWithUnknownCategory.length > 0) {
    const firstPassRequests = rowsWithUnknownCategory.map(row => buildRenderRequest(row, undefined));
    const firstPassResult = await renderEmailsForTenancyBatched(firstPassRequests);

    if (firstPassResult.status === "error") {
      for (const row of rowsWithUnknownCategory) {
        await markRenderError(row, firstPassResult.error);
      }
      return;
    }

    // Partition rows based on whether they need a second pass
    const needsSecondPass: { row: EmailOutbox, categoryId: string }[] = [];
    const noSecondPassNeeded: { row: EmailOutbox, output: typeof firstPassResult.data[0], categoryId: string | undefined }[] = [];

    for (let i = 0; i < rowsWithUnknownCategory.length; i++) {
      const row = rowsWithUnknownCategory[i];
      const output = firstPassResult.data[i];
      const category = listNotificationCategories().find(c => c.name === output.notificationCategory);
      const recipient = deserializeRecipient(row.to as Json);
      const hasUserId = "userId" in recipient;

      if (category?.can_disable && hasUserId) {
        needsSecondPass.push({ row, categoryId: category.id });
      } else {
        noSecondPassNeeded.push({ row, output, categoryId: category?.id });
      }
    }

    // Save emails that don't need a second pass
    for (const { row, output, categoryId } of noSecondPassNeeded) {
      await saveRenderedEmail(row, output, categoryId);
    }

    // Second pass for emails that need an unsubscribe link
    if (needsSecondPass.length > 0) {
      const secondPassRequests = await Promise.all(needsSecondPass.map(async ({ row, categoryId }) => {
        const unsubscribeLink = await tryGenerateUnsubscribeLink(row, categoryId);
        return buildRenderRequest(row, unsubscribeLink);
      }));

      const secondPassResult = await renderEmailsForTenancyBatched(secondPassRequests);
      if (secondPassResult.status === "error") {
        for (const { row } of needsSecondPass) {
          await markRenderError(row, secondPassResult.error);
        }
      } else {
        for (let i = 0; i < needsSecondPass.length; i++) {
          await saveRenderedEmail(needsSecondPass[i].row, secondPassResult.data[i], needsSecondPass[i].categoryId);
        }
      }
    }
  }
}

async function queueReadyEmails(): Promise<{ queuedCount: number }> {
  // Queue emails that are ready to send. Split into two queries for clarity and index usage.
  // We always require scheduledAt <= NOW() to respect the original scheduling intent.

  // Query 1: Fresh emails (scheduledAt has passed, no retry pending)
  const freshEmails = await globalPrismaClient.$queryRaw<{ id: string }[]>`
    UPDATE "EmailOutbox"
    SET "isQueued" = TRUE
    WHERE "isQueued" = FALSE
      AND "isPaused" = FALSE
      AND "skippedReason" IS NULL
      AND "finishedRenderingAt" IS NOT NULL
      AND "renderedHtml" IS NOT NULL
      AND "scheduledAt" <= NOW()
      AND "nextSendRetryAt" IS NULL
    RETURNING "id";
  `;

  // Query 2: Retry emails (both scheduledAt AND nextSendRetryAt have passed)
  // Clear nextSendRetryAt when queuing so the email is in a clean "queued" state.
  const retryEmails = await globalPrismaClient.$queryRaw<{ id: string }[]>`
    UPDATE "EmailOutbox"
    SET "isQueued" = TRUE, "nextSendRetryAt" = NULL
    WHERE "isQueued" = FALSE
      AND "isPaused" = FALSE
      AND "skippedReason" IS NULL
      AND "finishedRenderingAt" IS NOT NULL
      AND "renderedHtml" IS NOT NULL
      AND "scheduledAt" <= NOW()
      AND "nextSendRetryAt" <= NOW()
    RETURNING "id";
  `;

  return {
    queuedCount: freshEmails.length + retryEmails.length,
  };
}

async function prepareSendPlan(deltaSeconds: number): Promise<TenancySendBatch[]> {
  // Find tenancies with queued emails ready to send
  const tenancyIds = await globalPrismaClient.emailOutbox.findMany({
    where: {
      isPaused: false,
      skippedReason: null,
      finishedSendingAt: null,
      startedSendingAt: null,
      isQueued: true,
    },
    distinct: ["tenancyId"],
    select: { tenancyId: true },
  });

  const plan: TenancySendBatch[] = [];
  for (const entry of tenancyIds) {
    const [stats, boostExpiresAt] = await Promise.all([
      getEmailDeliveryStatsForTenancy(entry.tenancyId),
      getEmailCapacityBoostExpiresAt(entry.tenancyId),
    ]);
    const capacity = calculateCapacityRate(stats, boostExpiresAt);
    const quota = stochasticQuota(capacity.ratePerSecond * deltaSeconds);
    if (quota <= 0) continue;
    const rows = await claimEmailsForSending(globalPrismaClient, entry.tenancyId, quota);
    if (rows.length === 0) continue;
    plan.push({ tenancyId: entry.tenancyId, rows, capacityRatePerSecond: capacity.ratePerSecond });
  }
  return plan;
}

function stochasticQuota(value: number): number {
  const base = Math.floor(value);
  const fractional = value - base;
  return base + (Math.random() < fractional ? 1 : 0);
}

async function claimEmailsForSending(tx: PrismaClientTransaction, tenancyId: string, limit: number): Promise<EmailOutbox[]> {
  // Claim queued emails for sending
  // Note: queueReadyEmails() handles the time-based logic, so we just look for isQueued = TRUE
  return await tx.$queryRaw<EmailOutbox[]>(Prisma.sql`
    WITH selected AS (
      SELECT "tenancyId", "id"
      FROM "EmailOutbox"
      WHERE "tenancyId" = ${tenancyId}::uuid
        AND "isPaused" = FALSE
        AND "skippedReason" IS NULL
        AND "finishedSendingAt" IS NULL
        AND "finishedRenderingAt" IS NOT NULL
        AND "startedSendingAt" IS NULL
        AND "isQueued" = TRUE
      ORDER BY "priority" DESC, "scheduledAt" ASC, "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EmailOutbox" AS e
    SET "startedSendingAt" = NOW()
    FROM selected
    WHERE e."tenancyId" = selected."tenancyId" AND e."id" = selected."id"
    RETURNING e.*;
  `);
}

async function processSendPlan(plan: TenancySendBatch[]): Promise<void> {
  for (const batch of plan) {
    try {
      await processTenancyBatch(batch);
    } catch (error) {
      captureError("email-queue-step-sending-error", error);
    }
  }
}

type ProjectUserWithContacts = Prisma.ProjectUserGetPayload<{ include: { contactChannels: true } }>;

type TenancyProcessingContext = {
  tenancy: Tenancy,
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  emailConfig: Awaited<ReturnType<typeof getEmailConfig>>,
};

async function processTenancyBatch(batch: TenancySendBatch): Promise<void> {
  const tenancy = await getTenancy(batch.tenancyId) ?? throwErr("Tenancy not found in processTenancyBatch? Was the tenancy deletion not cascaded?");

  const prisma = await getPrismaClientForTenancy(tenancy);
  const emailConfig = await getEmailConfig(tenancy);

  const context: TenancyProcessingContext = {
    tenancy,
    prisma,
    emailConfig,
  };

  const promises = batch.rows.map((row) => processSingleEmail(context, row));
  await allPromisesAndWaitUntilEach(promises);
}

function getPrimaryEmail(user: ProjectUserWithContacts | undefined): string | undefined {
  if (!user) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const primaryChannel = user.contactChannels.find((channel) => channel.type === "EMAIL" && channel.isPrimary === "TRUE");
  return primaryChannel?.value ?? undefined;
}

type ResolvedRecipient =
  | { status: "ok", emails: string[] }
  | { status: "skip", reason: EmailOutboxSkippedReason, details?: Record<string, unknown> }
  | { status: "unsubscribe" };

async function processSingleEmail(context: TenancyProcessingContext, row: EmailOutbox): Promise<void> {
  try {
    const recipient = deserializeRecipient(row.to as Json);
    const resolution = await resolveRecipientEmails(context, row, recipient);

    if (resolution.status === "skip") {
      await markSkipped(row, resolution.reason, resolution.details);
      return;
    }

    if (resolution.status === "unsubscribe") {
      await markSkipped(row, EmailOutboxSkippedReason.USER_UNSUBSCRIBED);
      return;
    }

    // Verify email deliverability for each email address
    // If any email fails verification, skip the entire email with LIKELY_NOT_DELIVERABLE reason
    // TODO: In the future, if only one email fails verification, we may still want to send if the other emails are deliverable
    for (const email of resolution.emails) {
      const verifyResult = await verifyEmailDeliverability(
        email,
        row.shouldSkipDeliverabilityCheck,
        context.emailConfig.type
      );
      if (verifyResult.status === "not-deliverable") {
        await markSkipped(row, EmailOutboxSkippedReason.LIKELY_NOT_DELIVERABLE, {
          emailableResponse: verifyResult.emailableResponse,
          email,
        });
        return;
      }
    }

    const BLOCKED_PROJECT_ID = "2397ef60-a33e-4efb-ad9b-300da67ee29e";
    const BLOCKED_DOMAINS = ["gsmoal.com", "virgilian.com"];
    if (context.tenancy.project.id === BLOCKED_PROJECT_ID) {
      for (const email of resolution.emails) {
        const emailDomain = email.split("@")[1]?.toLowerCase();
        const blockedDomain = emailDomain
          ? BLOCKED_DOMAINS.find((domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`))
          : undefined;
        if (blockedDomain) {
          console.warn(`[email-queue] Blocked email to ${email} from project ${BLOCKED_PROJECT_ID} — domain @${blockedDomain} (or subdomain) is blocked for this project`);
          await markSkipped(row, EmailOutboxSkippedReason.LIKELY_NOT_DELIVERABLE, {
            reason: "domain_blocked_for_project",
            blockedDomain,
            email,
          });
          return;
        }
      }
    }

    const result = getEnvBoolean("STACK_EMAIL_BRANCHING_DISABLE_QUEUE_SENDING")
      ? Result.error({ errorType: "email-sending-disabled", canRetry: false, message: "Email sending is disabled", rawError: new Error("Email sending is disabled") })
      : await lowLevelSendEmailDirectWithoutRetries({
        tenancyId: context.tenancy.id,
        emailConfig: context.emailConfig,
        to: resolution.emails,
        subject: row.renderedSubject ?? "",
        html: row.renderedHtml ?? undefined,
        text: row.renderedText ?? undefined,
      });

    if (result.status === "error") {
      const newAttemptCount = row.sendRetries + 1;
      const isAttemptsExhausted = result.error.canRetry && newAttemptCount >= MAX_SEND_ATTEMPTS;
      const canRetry = result.error.canRetry && !isAttemptsExhausted;

      // Build error entry for this attempt
      const errorEntry: SendAttemptError = {
        attemptNumber: newAttemptCount,
        timestamp: new Date().toISOString(),
        externalMessage: result.error.message ?? result.error.errorType,
        externalDetails: { errorType: result.error.errorType },
        internalMessage: result.error.message ?? result.error.errorType,
        internalDetails: { rawError: errorToNiceString(result.error.rawError), errorType: result.error.errorType },
      };
      const updatedErrors = appendSendAttemptError(row.sendAttemptErrors as SendAttemptError[] | null, errorEntry);

      if (canRetry) {
        // Schedule retry: unclaim the email and set nextSendRetryAt
        const backoffMs = calculateRetryBackoffMs(newAttemptCount);
        await globalPrismaClient.emailOutbox.update({
          where: {
            tenancyId_id: {
              tenancyId: row.tenancyId,
              id: row.id,
            },
            finishedSendingAt: null,
          },
          data: {
            startedSendingAt: null,
            isQueued: false,
            sendRetries: newAttemptCount,
            nextSendRetryAt: new Date(Date.now() + backoffMs),
            sendAttemptErrors: updatedErrors as Prisma.InputJsonArray,
          },
        });
      } else {
        // Mark as permanent failure - either "attempts_exhausted" (retryable but hit limit) or "permanent_error" (non-retryable)
        const failureReason = isAttemptsExhausted ? "attempts_exhausted" : "permanent_error";

        if (isAttemptsExhausted) {
          captureError("email-queue-step-retries-exhausted", new StackAssertionError(`Email failed after ${newAttemptCount} attempts`, {
            cause: result.error.rawError,
            emailId: row.id,
            tenancyId: row.tenancyId,
            errorType: result.error.errorType,
            errorMessage: result.error.message,
            allAttemptErrors: updatedErrors,
          }));
        }

        await globalPrismaClient.emailOutbox.update({
          where: {
            tenancyId_id: {
              tenancyId: row.tenancyId,
              id: row.id,
            },
            finishedSendingAt: null,
          },
          data: {
            finishedSendingAt: new Date(),
            canHaveDeliveryInfo: false,
            sendRetries: newAttemptCount,
            sendAttemptErrors: updatedErrors as Prisma.InputJsonArray,
            sendServerErrorExternalMessage: result.error.message,
            sendServerErrorExternalDetails: { errorType: result.error.errorType },
            sendServerErrorInternalMessage: result.error.message,
            sendServerErrorInternalDetails: {
              rawError: errorToNiceString(result.error.rawError),
              errorType: result.error.errorType,
              attemptCount: newAttemptCount,
              failureReason,
              allAttemptErrors: updatedErrors as Json[],
            },
          },
        });
      }
    } else {
      // Success - mark as sent (don't increment sendRetries since this wasn't a failure)
      await globalPrismaClient.emailOutbox.update({
        where: {
          tenancyId_id: {
            tenancyId: row.tenancyId,
            id: row.id,
          },
          finishedSendingAt: null,
        },
        data: {
          finishedSendingAt: new Date(),
          canHaveDeliveryInfo: false,
          sendServerErrorExternalMessage: null,
          sendServerErrorExternalDetails: Prisma.DbNull,
          sendServerErrorInternalMessage: null,
          sendServerErrorInternalDetails: Prisma.DbNull,
        },
      });
    }
  } catch (error) {
    captureError("email-queue-step-sending-single-error", error);
    await globalPrismaClient.emailOutbox.update({
      where: {
        tenancyId_id: {
          tenancyId: row.tenancyId,
          id: row.id,
        },
        finishedSendingAt: null,
      },
      data: {
        finishedSendingAt: new Date(),
        canHaveDeliveryInfo: false,
        sendServerErrorExternalMessage: "An error occurred while sending the email. If you are the admin of this project, please check the email configuration and try again.",
        sendServerErrorExternalDetails: {},
        sendServerErrorInternalMessage: errorToNiceString(error),
        sendServerErrorInternalDetails: {},
      },
    });
  }
}

async function resolveRecipientEmails(
  context: TenancyProcessingContext,
  row: EmailOutbox,
  recipient: ReturnType<typeof deserializeRecipient>,
): Promise<ResolvedRecipient> {
  if (recipient.type === "custom-emails") {
    if (recipient.emails.length === 0) {
      return { status: "skip", reason: EmailOutboxSkippedReason.NO_EMAIL_PROVIDED };
    }
    return { status: "ok", emails: recipient.emails };
  }

  const user = await context.prisma.projectUser.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId: context.tenancy.id,
        projectUserId: recipient.userId,
      },
    },
    include: {
      contactChannels: true,
    },
  });
  if (!user) {
    return { status: "skip", reason: EmailOutboxSkippedReason.USER_ACCOUNT_DELETED };
  }

  const primaryEmail = getPrimaryEmail(user);
  let emails: string[] = [];
  if (recipient.type === "user-custom-emails") {
    emails = recipient.emails.length > 0 ? recipient.emails : primaryEmail ? [primaryEmail] : [];
    if (emails.length === 0) {
      return { status: "skip", reason: EmailOutboxSkippedReason.NO_EMAIL_PROVIDED };
    }
  } else {
    if (!primaryEmail) {
      return { status: "skip", reason: EmailOutboxSkippedReason.USER_HAS_NO_PRIMARY_EMAIL };
    }
    emails = [primaryEmail];
  }

  if (row.renderedNotificationCategoryId) {
    const canSend = await shouldSendEmail(context, row.renderedNotificationCategoryId, recipient.userId);
    if (!canSend) {
      return { status: "unsubscribe" };
    }
  }

  return { status: "ok", emails };
}

async function shouldSendEmail(
  context: TenancyProcessingContext,
  categoryId: string,
  userId: string,
): Promise<boolean> {
  const category = getNotificationCategoryById(categoryId);
  if (!category) {
    throw new StackAssertionError("Invalid notification category id, we should have validated this before calling shouldSendEmail", { categoryId, userId });
  }
  if (!category.can_disable) {
    return true;
  }

  const enabled = await hasNotificationEnabled(context.tenancy, userId, categoryId);
  return enabled;
}

async function markSkipped(row: EmailOutbox, reason: EmailOutboxSkippedReason, details: Record<string, unknown> = {}): Promise<void> {
  await globalPrismaClient.emailOutbox.update({
    where: {
      tenancyId_id: {
        tenancyId: row.tenancyId,
        id: row.id,
      },
      skippedReason: null,
    },
    data: {
      skippedReason: reason,
      skippedDetails: details as Prisma.InputJsonValue,
    },
  });
}


export function serializeRecipient(recipient: EmailOutboxRecipient): Json {
  switch (recipient.type) {
    case "user-primary-email": {
      return {
        type: recipient.type,
        userId: recipient.userId,
      };
    }
    case "user-custom-emails": {
      return {
        type: recipient.type,
        userId: recipient.userId,
        emails: recipient.emails,
      };
    }
    case "custom-emails": {
      return {
        type: recipient.type,
        emails: recipient.emails,
      };
    }
    default: {
      throw new StackAssertionError("Unknown EmailOutbox recipient type", { recipient });
    }
  }
}

export function deserializeRecipient(raw: Json): EmailOutboxRecipient {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StackAssertionError("Malformed EmailOutbox recipient payload", { raw });
  }
  const base = raw as Record<string, Json>;
  const type = base.type;
  if (type === "user-primary-email") {
    const userId = base.userId;
    if (typeof userId !== "string") {
      throw new StackAssertionError("Expected userId to be present for user-primary-email recipient", { raw });
    }
    return { type, userId };
  }
  if (type === "user-custom-emails") {
    const userId = base.userId;
    const emails = base.emails;
    if (typeof userId !== "string" || !Array.isArray(emails) || !emails.every((item) => typeof item === "string")) {
      throw new StackAssertionError("Invalid user-custom-emails recipient payload", { raw });
    }
    return { type, userId, emails: emails as string[] };
  }
  if (type === "custom-emails") {
    const emails = base.emails;
    if (!Array.isArray(emails) || !emails.every((item) => typeof item === "string")) {
      throw new StackAssertionError("Invalid custom-emails recipient payload", { raw });
    }
    return { type, emails: emails as string[] };
  }
  throw new StackAssertionError("Unknown EmailOutbox recipient type", { raw });
}
