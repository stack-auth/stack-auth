import { BooleanTrue } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";

export type ExternalDbSyncFusebox = {
  sequencerEnabled: boolean,
  pollerEnabled: boolean,
};

const fuseboxSelect = {
  sequencerEnabled: true,
  pollerEnabled: true,
};

// Default values match the Prisma schema defaults
const defaultFusebox: ExternalDbSyncFusebox = {
  sequencerEnabled: true,
  pollerEnabled: true,
};

export async function getExternalDbSyncFusebox(): Promise<ExternalDbSyncFusebox> {
  const result = await globalPrismaClient.externalDbSyncMetadata.findFirst({
    where: { singleton: BooleanTrue.TRUE },
    select: fuseboxSelect,
  });
  // Return defaults if row doesn't exist yet (row is created on first update)
  return result ?? defaultFusebox;
}

export async function updateExternalDbSyncFusebox(
  updates: ExternalDbSyncFusebox,
): Promise<ExternalDbSyncFusebox> {
  // Upsert is fine here - updates are infrequent and typically manual/admin actions
  return await globalPrismaClient.externalDbSyncMetadata.upsert({
    where: { singleton: BooleanTrue.TRUE },
    create: { singleton: BooleanTrue.TRUE, ...updates },
    update: updates,
    select: fuseboxSelect,
  });
}
