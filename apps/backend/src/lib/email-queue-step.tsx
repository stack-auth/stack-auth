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
  const workerId = randomUUID();

  const deltaSeconds = await withTraceSpan("runEmailQueueStep-updateLastExecutionTime", updateLastExecutionTime)();
  if (deltaSeconds <= 0) {
    return;
  }


  const pendingRender = await withTraceSpan("runEmailQueueStep-claimEmailsForRendering", claimEmailsForRendering)(workerId);
  if (pendingRender.length > 0) {
    console.log(`Rendering ${pendingRender.length} emails`);
  }
  await withTraceSpan("runEmailQueueStep-renderEmails", renderEmails)(workerId, pendingRender);
  await withTraceSpan("runEmailQueueStep-retryEmailsStuckInRendering", retryEmailsStuckInRendering)();

  await withTraceSpan("runEmailQueueStep-queueReadyEmails", queueReadyEmails)();

  const sendPlan = await withTraceSpan("runEmailQueueStep-prepareSendPlan", prepareSendPlan)(deltaSeconds);
  if (sendPlan.length > 0) {
    console.log(`Sending emails from ${sendPlan.length} tenancies`);
  }
  await withTraceSpan("runEmailQueueStep-processSendPlan", processSendPlan)(sendPlan);
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

  const [{ delta }] = await globalPrismaClient.$queryRaw<{ delta: number }[]>`
    WITH now_ts AS (
      SELECT NOW() AS now
    ),
    existing AS (
      SELECT "lastExecutedAt"
      FROM "EmailOutboxProcessingMetadata"
      WHERE "key" = ${key}
    ),
    action AS (
      INSERT INTO "EmailOutboxProcessingMetadata" ("key", "lastExecutedAt", "updatedAt")
      VALUES (${key}, (SELECT now FROM now_ts), (SELECT now FROM now_ts))
      ON CONFLICT ("key") DO UPDATE SET
        "updatedAt" = (SELECT now FROM now_ts),
        "lastExecutedAt" = CASE
          WHEN "EmailOutboxProcessingMetadata"."lastExecutedAt" IS NULL
            OR "EmailOutboxProcessingMetadata"."lastExecutedAt" < (SELECT now FROM now_ts)
          THEN (SELECT now FROM now_ts)
          ELSE "EmailOutboxProcessingMetadata"."lastExecutedAt"
        END
      RETURNING "lastExecutedAt"
    )
    SELECT
      CASE
        WHEN (SELECT "lastExecutedAt" FROM existing) IS NULL THEN 0
        WHEN (SELECT "lastExecutedAt" FROM action) = (SELECT "lastExecutedAt" FROM existing) THEN 0
        ELSE EXTRACT(EPOCH FROM (
          (SELECT "lastExecutedAt" FROM action) -
          (SELECT "lastExecutedAt" FROM existing)
        ))
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
  const userRecipientRows = group.filter((row) => {
    const recipient = deserializeRecipient(row.to as Json);
    return recipient.type !== "custom-emails";
  });

  const userIds = new Set<string>();
  for (const row of userRecipientRows) {
    const recipient = deserializeRecipient(row.to as Json);
    if ("userId" in recipient) {
      userIds.add(recipient.userId);
    }
  }

  const users = userIds.size > 0 ? await prisma.projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      projectUserId: { in: Array.from(userIds) },
    },
    include: {
      contactChannels: true,
    },
  }) : [];

  const userMap = new Map(users.map(user => [user.projectUserId, user]));

  const requests = await Promise.all(group.map(async (row) => {
    const themeSource = getEmailThemeForThemeId(tenancy, row.themeId ?? false);

    const recipient = deserializeRecipient(row.to as Json);
    let userDisplayName: string | null = null;
    let unsubscribeLink: string | undefined;
    if ("userId" in recipient) {
      const user = userMap.get(recipient.userId);
      userDisplayName = user?.displayName ?? null;
      if (row.renderedNotificationCategoryId) {
        const category = getNotificationCategoryById(row.renderedNotificationCategoryId);
        if (category?.can_disable) {
          const unsubscribeResult = await Result.fromPromise(generateUnsubscribeLink(tenancy, recipient.userId, row.renderedNotificationCategoryId));
          if (unsubscribeResult.status === "ok") {
            unsubscribeLink = unsubscribeResult.data;
          } else {
            captureError("generate-unsubscribe-link", unsubscribeResult.error);
          }
        }
      }
    }

    return {
      templateSource: row.tsxSource,
      themeSource,
      input: {
        user: { displayName: userDisplayName },
        project: { displayName: tenancy.project.display_name },
        variables: filterUndefined({
          projectDisplayName: tenancy.project.display_name,
          userDisplayName: userDisplayName,
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
  }));

  const renderResult = await renderEmailsForTenancyBatched(requests);
  if (renderResult.status === "error") {
    captureError("email-rendering-failed", renderResult.error);
    for (const row of group) {
      await globalPrismaClient.emailOutbox.updateMany({
        where: {
          tenancyId,
          id: row.id,
          renderedByWorkerId: workerId,
        },
        data: {
          renderErrorExternalMessage: "An error occurred while rendering the email. Make sure the template/draft is valid and the theme is set correctly.",
          renderErrorExternalDetails: {},
          renderErrorInternalMessage: renderResult.error,
          renderErrorInternalDetails: { error: renderResult.error },
          finishedRenderingAt: new Date(),
        },
      });
    }
    return;
  }

  const outputs = renderResult.data;
  for (let index = 0; index < group.length; index++) {
    const row = group[index];
    const output = outputs[index];
    const notificationCategory = listNotificationCategories().find((category) => category.name === output.notificationCategory);
    await globalPrismaClient.emailOutbox.updateMany({
      where: {
        tenancyId,
        id: row.id,
        renderedByWorkerId: workerId,
      },
      data: {
        renderedHtml: output.html,
        renderedText: output.text,
        renderedSubject: output.subject ?? "",
        renderedNotificationCategoryId: notificationCategory?.id,
        renderedIsTransactional: notificationCategory?.name === "Transactional",  // TODO this should use smarter logic for notification category handling
        renderErrorExternalMessage: null,
        renderErrorExternalDetails: Prisma.DbNull,
        renderErrorInternalMessage: null,
        renderErrorInternalDetails: Prisma.DbNull,
        finishedRenderingAt: new Date(),
      },
    });
  }
}

async function queueReadyEmails(): Promise<void> {
  await globalPrismaClient.$executeRaw`
    UPDATE "EmailOutbox"
    SET "isQueued" = TRUE
    WHERE "isQueued" = FALSE
      AND "isPaused" = FALSE
      AND "finishedRenderingAt" IS NOT NULL
      AND "renderedHtml" IS NOT NULL
      AND "scheduledAt" <= NOW()
  `;
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

  const userIds = new Set<string>();
  for (const row of batch.rows) {
    const recipient = deserializeRecipient(row.to as Json);
    if ("userId" in recipient) {
      userIds.add(recipient.userId);
    }
  }

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
