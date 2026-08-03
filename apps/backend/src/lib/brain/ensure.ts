import { PrismaClientTransaction } from "@/prisma-client";

/**
 * Ensures the singleton Brain row exists for a tenancy. Safe to call inside
 * any transaction; createMany + skipDuplicates makes it idempotent under
 * concurrent first-writers.
 */
export async function ensureBrainRow(client: PrismaClientTransaction, tenancyId: string): Promise<void> {
  await client.brain.createMany({
    data: [{
      tenancyId,
      updatedAt: new Date(),
    }],
    skipDuplicates: true,
  });
}
