import { globalPrismaClient } from "@/prisma-client";
import { getTenancy } from "@/lib/tenancies";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";

/**
 * Deletes stale "guest" (anonymous) accounts that have been inactive longer than each project's configured
 * TTL (`auth.anonymous.expireGuestsAfterDays`). Invoked periodically by the cleanup cron endpoint.
 *
 * Deletion goes through `usersCrudHandlers.adminDelete` (NOT a raw SQL DELETE) so external-DB-sync
 * `DeletedRow` records, webhooks, and cascade cleanup all happen correctly — a raw delete would desync
 * mirrored databases.
 *
 * TTL lives in per-project JSON config, so we enumerate only tenancies that actually have guests, resolve
 * each tenancy's TTL, and batch-delete its stale guests. The query is backed by the existing
 * `ProjectUser_lastActiveAt` index (tenancyId, isAnonymous, lastActiveAt).
 */
export async function runCleanupAnonymousUsersStep(options: {
  maxDurationMs?: number,
  batchSize?: number,
  now?: Date,
} = {}): Promise<{ deleted: number, tenanciesProcessed: number }> {
  const maxDurationMs = options.maxDurationMs ?? 2 * 60 * 1000;
  const batchSize = options.batchSize ?? 200;
  const now = options.now ?? new Date();
  const startTime = performance.now();

  // Only consider tenancies that actually have at least one anonymous user (cheap, index-backed via the
  // leading columns of ProjectUser_lastActiveAt).
  const tenancyRows = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
    SELECT DISTINCT "tenancyId" FROM "ProjectUser" WHERE "isAnonymous" = TRUE
  `;

  let deleted = 0;
  let tenanciesProcessed = 0;

  for (const { tenancyId } of tenancyRows) {
    if (performance.now() - startTime >= maxDurationMs) break;

    const tenancy = await getTenancy(tenancyId);
    if (!tenancy) continue;

    const expireGuestsAfterDays = tenancy.config.auth.anonymous.expireGuestsAfterDays;
    // null / undefined = never expire.
    if (expireGuestsAfterDays == null) continue;

    tenanciesProcessed++;
    const cutoff = new Date(now.getTime() - expireGuestsAfterDays * 24 * 60 * 60 * 1000);

    // Delete stale guests for this tenancy in batches until none remain (or we run out of time budget).
    while (performance.now() - startTime < maxDurationMs) {
      const staleUsers = await globalPrismaClient.projectUser.findMany({
        where: {
          tenancyId,
          isAnonymous: true,
          lastActiveAt: { lt: cutoff },
        },
        select: { projectUserId: true },
        take: batchSize,
      });
      if (staleUsers.length === 0) break;

      for (const user of staleUsers) {
        try {
          await usersCrudHandlers.adminDelete({
            tenancy,
            user_id: user.projectUserId,
            allowedErrorTypes: [],
          });
          deleted++;
        } catch (e) {
          // A single failed deletion (e.g. a concurrent delete) shouldn't abort the whole sweep.
          captureError("cleanup-anonymous-users", e);
        }
      }

      // If we got fewer than a full batch, there are no more stale guests for this tenancy.
      if (staleUsers.length < batchSize) break;
    }
  }

  return { deleted, tenanciesProcessed };
}
