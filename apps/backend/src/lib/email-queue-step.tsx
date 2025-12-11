import { calculateCapacityRate, getEmailDeliveryStatsForTenancy } from "@/lib/email-delivery-stats";
import { getEmailThemeForThemeId, renderEmailsForTenancyBatched } from "@/lib/email-rendering";
import { EmailOutboxRecipient, getEmailConfig, } from "@/lib/emails";
import { generateUnsubscribeLink, getNotificationCategoryById, hasNotificationEnabled, listNotificationCategories } from "@/lib/notification-categories";
import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, PrismaClientTransaction } from "@/prisma-client";
import { withTraceSpan } from "@/utils/telemetry";
import { allPromisesAndWaitUntilEach } from "@/utils/vercel";
import { EmailOutbox, EmailOutboxSkippedReason, Prisma } from "@prisma/client";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { captureError, errorToNiceString, StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { randomUUID } from "node:crypto";
import { lowLevelSendEmailDirectViaProvider } from "./emails-low-level";

const MAX_RENDER_BATCH = 50;

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
  if (deltaSeconds <= 0) {
    return;
  }
  const updateLastExecutionTimeEnd = performance.now();


  const pendingRender = await withTraceSpan("runEmailQueueStep-claimEmailsForRendering", claimEmailsForRendering)(workerId);
  await withTraceSpan("runEmailQueueStep-renderEmails", renderEmails)(workerId, pendingRender);
  await withTraceSpan("runEmailQueueStep-retryEmailsStuckInRendering", retryEmailsStuckInRendering)();
  const renderingEnd = performance.now();

  const { queuedCount } = await withTraceSpan("runEmailQueueStep-queueReadyEmails", queueReadyEmails)();
  const queueReadyEnd = performance.now();

  const sendPlan = await withTraceSpan("runEmailQueueStep-prepareSendPlan", prepareSendPlan)(deltaSeconds);
  await withTraceSpan("runEmailQueueStep-processSendPlan", processSendPlan)(sendPlan);
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
    },
    data: {
      renderedByWorkerId: null,
      startedRenderingAt: null,
    },
  });
  if (res.length > 0) {
    captureError("email-queue-step-stuck-in-rendering", new StackAssertionError("Emails stuck in rendering! This should never happen. Resetting them to be re-rendered.", {
      emails: res.map(e => e.id),
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
        WHEN (SELECT previous_timestamp FROM result) IS NULL THEN 60.0
        -- Normal update case: compute actual delta
        ELSE EXTRACT(EPOCH FROM 
          (SELECT new_timestamp FROM result) - 
          (SELECT previous_timestamp FROM result)
        )
      END AS delta;
  `;

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
          userDisplayName,
          ...filterUndefined((row.extraRenderVariables ?? {}) as Record<string, string | null>),
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
      captureError("email-rendering-failed", result.error);
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
      captureError("email-rendering-failed", firstPassResult.error);
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
        captureError("email-rendering-failed-second-pass", secondPassResult.error);
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
  const res = await globalPrismaClient.$queryRaw<{ queuedCount: number }>`
    UPDATE "EmailOutbox"
    SET "isQueued" = TRUE
    WHERE "isQueued" = FALSE
      AND "isPaused" = FALSE
      AND "finishedRenderingAt" IS NOT NULL
      AND "renderedHtml" IS NOT NULL
      AND "scheduledAt" <= NOW()
    RETURNING "id";
  `;
  return {
    queuedCount: res.length,
  };
}

async function prepareSendPlan(deltaSeconds: number): Promise<TenancySendBatch[]> {
  const tenancyIds = await globalPrismaClient.emailOutbox.findMany({
    where: {
      isQueued: true,
      isPaused: false,
      startedSendingAt: null,
    },
    distinct: ["tenancyId"],
    select: { tenancyId: true },
  });

  const plan: TenancySendBatch[] = [];
  for (const entry of tenancyIds) {
    const stats = await getEmailDeliveryStatsForTenancy(entry.tenancyId);
    const capacity = calculateCapacityRate(stats);
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
  return await tx.$queryRaw<EmailOutbox[]>(Prisma.sql`
    WITH selected AS (
      SELECT "tenancyId", "id"
      FROM "EmailOutbox"
      WHERE "tenancyId" = ${tenancyId}::uuid
        AND "isQueued" = TRUE
        AND "isPaused" = FALSE
        AND "finishedRenderingAt" IS NOT NULL
        AND "startedSendingAt" IS NULL
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
  | { status: "skip", reason: EmailOutboxSkippedReason }
  | { status: "unsubscribe" };

async function processSingleEmail(context: TenancyProcessingContext, row: EmailOutbox): Promise<void> {
  try {
    const recipient = deserializeRecipient(row.to as Json);
    const resolution = await resolveRecipientEmails(context, row, recipient);

    if (resolution.status === "skip") {
      await markSkipped(row, resolution.reason);
      return;
    }

    if (resolution.status === "unsubscribe") {
      await markSkipped(row, EmailOutboxSkippedReason.USER_UNSUBSCRIBED);
      return;
    }

    const result = await lowLevelSendEmailDirectViaProvider({
      tenancyId: context.tenancy.id,
      emailConfig: context.emailConfig,
      to: resolution.emails,
      subject: row.renderedSubject ?? "",
      html: row.renderedHtml ?? undefined,
      text: row.renderedText ?? undefined,
      shouldSkipDeliverabilityCheck: row.shouldSkipDeliverabilityCheck,
    });

    if (result.status === "error") {
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
          sendServerErrorExternalMessage: result.error.message,
          sendServerErrorExternalDetails: { errorType: result.error.errorType },
          sendServerErrorInternalMessage: result.error.message,
          sendServerErrorInternalDetails: { rawError: errorToNiceString(result.error.rawError), errorType: result.error.errorType },
        },
      });
    } else {
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

async function markSkipped(row: EmailOutbox, reason: EmailOutboxSkippedReason): Promise<void> {
  await globalPrismaClient.emailOutbox.update({
    where: {
      tenancyId_id: {
        tenancyId: row.tenancyId,
        id: row.id,
      },
    },
    data: {
      skippedReason: reason,
      finishedSendingAt: new Date(),
      canHaveDeliveryInfo: false,
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
