import { BooleanTrue } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";

export type ExternalDbSyncFusebox = {
  sequencerEnabled: boolean,
  pollerEnabled: boolean,
  syncEngineEnabled: boolean,
};

const fuseboxSelect = {
  sequencerEnabled: true,
  pollerEnabled: true,
  syncEngineEnabled: true,
};

export async function getExternalDbSyncFusebox(): Promise<ExternalDbSyncFusebox> {
  return await globalPrismaClient.externalDbSyncMetadata.upsert({
    where: { singleton: BooleanTrue.TRUE },
    create: { singleton: BooleanTrue.TRUE },
    update: {},
    select: fuseboxSelect,
  });
}

export async function updateExternalDbSyncFusebox(
  updates: ExternalDbSyncFusebox,
): Promise<ExternalDbSyncFusebox> {
  return await globalPrismaClient.externalDbSyncMetadata.upsert({
    where: { singleton: BooleanTrue.TRUE },
    create: { singleton: BooleanTrue.TRUE, ...updates },
    update: updates,
    select: fuseboxSelect,
  });
}
