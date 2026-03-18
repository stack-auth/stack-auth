import { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient, PrismaClientTransaction, RawQuery, rawQuery } from "@/prisma-client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type EmailDeliveryWindowStats = {
  sent: number,
  bounced: number,
  markedAsSpam: number,
};

export type EmailDeliveryStats = {
  hour: EmailDeliveryWindowStats,
  day: EmailDeliveryWindowStats,
  week: EmailDeliveryWindowStats,
  month: EmailDeliveryWindowStats,
};

export function calculatePenaltyFactor(sent: number, bounced: number, spam: number): number {
  if (sent === 0) {
    return 1;
  }
  const failures = bounced + 50 * spam;
  const failureRate = failures / sent;
  return Math.max(0.1, Math.min(1, 1 - failureRate));
}

const defaultEmailCapacityPerHour = Number.parseInt(getEnvVariable("STACK_DEFAULT_EMAIL_CAPACITY_PER_HOUR", "200"));
if (!Number.isFinite(defaultEmailCapacityPerHour)) {
  throw new StackAssertionError(`Invalid STACK_DEFAULT_EMAIL_CAPACITY_PER_HOUR environment variable: ${getEnvVariable("STACK_DEFAULT_EMAIL_CAPACITY_PER_HOUR", "<not set>")}`);
}

const BOOST_MULTIPLIER = 4;

export function calculateCapacityRate(stats: EmailDeliveryStats, boostExpiresAt?: Date | null) {
  const penaltyFactor = Math.min(
    calculatePenaltyFactor(stats.week.sent, stats.week.bounced, stats.week.markedAsSpam),
    calculatePenaltyFactor(stats.day.sent, stats.day.bounced, stats.day.markedAsSpam),
    calculatePenaltyFactor(stats.hour.sent, stats.hour.bounced, stats.hour.markedAsSpam)
  );
  const hourlyBaseline = defaultEmailCapacityPerHour + (4 * stats.month.sent / 30 / 24);  // default capacity + 4x the average throughput during the last month
  const ratePerHour = Math.max(hourlyBaseline * penaltyFactor, defaultEmailCapacityPerHour / 4);  // multiply by penalty factor, at least 1/4th of the default capacity

  const isBoostActive = boostExpiresAt != null && boostExpiresAt > new Date();
  const boostMultiplier = isBoostActive ? BOOST_MULTIPLIER : 1;

  const ratePerSecond = (ratePerHour / 60 / 60) * boostMultiplier;
  return { ratePerSecond, boostMultiplier, penaltyFactor, isBoostActive };
}

const deliveryStatsQuery = (tenancyId: string): RawQuery<EmailDeliveryStats> => ({
  supportedPrismaClients: ["global"],
  readOnlyQuery: true,
  sql: Prisma.sql`
    SELECT
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 hour' AND "sendServerErrorInternalMessage" IS NULL AND "skippedReason" IS NULL THEN 1 ELSE 0 END)::bigint AS sent_last_hour,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 day' AND "sendServerErrorInternalMessage" IS NULL AND "skippedReason" IS NULL THEN 1 ELSE 0 END)::bigint AS sent_last_day,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 week' AND "sendServerErrorInternalMessage" IS NULL AND "skippedReason" IS NULL THEN 1 ELSE 0 END)::bigint AS sent_last_week,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 month' AND "sendServerErrorInternalMessage" IS NULL AND "skippedReason" IS NULL THEN 1 ELSE 0 END)::bigint AS sent_last_month,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 hour' AND "bouncedAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS bounced_last_hour,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 day' AND "bouncedAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS bounced_last_day,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 week' AND "bouncedAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS bounced_last_week,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 month' AND "bouncedAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS bounced_last_month,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 hour' AND "markedAsSpamAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS spam_last_hour,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 day' AND "markedAsSpamAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS spam_last_day,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 week' AND "markedAsSpamAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS spam_last_week,
      SUM(CASE WHEN "finishedSendingAt" >= NOW() - INTERVAL '1 month' AND "markedAsSpamAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS spam_last_month
    FROM "EmailOutbox"
    WHERE "tenancyId" = ${tenancyId}::uuid
  `,
  postProcess: (rows) => {
    const row = rows[0] ?? {
      sent_last_hour: 0n,
      sent_last_day: 0n,
      sent_last_week: 0n,
      sent_last_month: 0n,
      bounced_last_hour: 0n,
      bounced_last_day: 0n,
      bounced_last_week: 0n,
      bounced_last_month: 0n,
      spam_last_hour: 0n,
      spam_last_day: 0n,
      spam_last_week: 0n,
      spam_last_month: 0n,
    };
    const toNumber = (value: unknown) => Number(value ?? 0);
    return {
      hour: {
        sent: toNumber(row.sent_last_hour),
        bounced: toNumber(row.bounced_last_hour),
        markedAsSpam: toNumber(row.spam_last_hour),
      },
      day: {
        sent: toNumber(row.sent_last_day),
        bounced: toNumber(row.bounced_last_day),
        markedAsSpam: toNumber(row.spam_last_day),
      },
      week: {
        sent: toNumber(row.sent_last_week),
        bounced: toNumber(row.bounced_last_week),
        markedAsSpam: toNumber(row.spam_last_week),
      },
      month: {
        sent: toNumber(row.sent_last_month),
        bounced: toNumber(row.bounced_last_month),
        markedAsSpam: toNumber(row.spam_last_month),
      },
    };
  },
});

export async function getEmailDeliveryStatsForTenancy(tenancyId: string, tx?: PrismaClientTransaction): Promise<EmailDeliveryStats> {
  const client = tx ?? globalPrismaClient;
  return await rawQuery(client, deliveryStatsQuery(tenancyId));
}

export async function getEmailCapacityBoostExpiresAt(tenancyId: string, tx?: PrismaClientTransaction): Promise<Date | null> {
  const client = tx ?? globalPrismaClient;
  const tenancy = await client.tenancy.findUniqueOrThrow({
    where: { id: tenancyId },
    select: { emailCapacityBoostExpiresAt: true },
  });
  return tenancy.emailCapacityBoostExpiresAt;
}
