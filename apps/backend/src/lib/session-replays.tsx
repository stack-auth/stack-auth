import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClientWithReplica } from "@/prisma-client";

export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export async function findRecentSessionReplay(prisma: PrismaClientWithReplica<PrismaClient>, options: {
  tenancyId: string,
  refreshTokenId: string,
}) {
  const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS);
  const maxDurationCutoff = new Date(Date.now() - MAX_SESSION_DURATION_MS);
  return await prisma.sessionReplay.findFirst({
    where: {
      tenancyId: options.tenancyId,
      refreshTokenId: options.refreshTokenId,
      updatedAt: { gte: cutoff },
      startedAt: { gte: maxDurationCutoff },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, startedAt: true, lastEventAt: true },
  });
}
