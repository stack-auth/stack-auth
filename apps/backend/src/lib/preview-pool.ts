import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { BooleanTrue, Prisma } from "@/generated/prisma/client";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { isPreviewModeEnabled } from "@/lib/preview-mode";
import { seedDummyProject, refreshDummyProjectLiveTokenRefreshEvents } from "@/lib/seed-dummy-data";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy, globalPrismaClient, isPrismaError, sqlQuoteIdent, type PrismaClientTransaction } from "@/prisma-client";
import type { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

const PREVIEW_POOL_METADATA_KEY = "stackPreviewPool";
const DEFAULT_READY_POOL_SIZE = 3;
const DEFAULT_LEASE_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_MAX_DELETE_PER_RUN = 1;

type PreviewPoolState = "ready" | "leased";

type PreviewPoolMetadata = {
  version: 1,
  state: PreviewPoolState,
  projectId: string,
  userId: string,
  createdAtMillis: number,
  leasedAtMillis: number | null,
  leaseExpiresAtMillis: number | null,
};

type PreviewPoolLease = {
  projectId: string,
  userId: string,
  accessToken: string,
  refreshToken: string,
};

type TableWithColumn = {
  table_schema: string,
  table_name: string,
};

function assertPreviewModeEnabled() {
  if (!isPreviewModeEnabled()) {
    throw new StatusError(StatusError.Forbidden, "Preview pool endpoints are only available in preview mode");
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = getEnvVariable(name, "");
  if (raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function getReadyPoolSize(): number {
  return parsePositiveIntegerEnv("STACK_PREVIEW_POOL_READY_SIZE", DEFAULT_READY_POOL_SIZE);
}

function getLeaseDurationMs(): number {
  return parsePositiveIntegerEnv("STACK_PREVIEW_POOL_LEASE_DURATION_MS", DEFAULT_LEASE_DURATION_MS);
}

function getCleanupMaxDeletePerRun(): number {
  return parsePositiveIntegerEnv("STACK_PREVIEW_POOL_CLEANUP_MAX_DELETE_PER_RUN", DEFAULT_CLEANUP_MAX_DELETE_PER_RUN);
}

function previewPoolMetadataToJson(metadata: PreviewPoolMetadata): Prisma.InputJsonObject {
  return {
    version: metadata.version,
    state: metadata.state,
    projectId: metadata.projectId,
    userId: metadata.userId,
    createdAtMillis: metadata.createdAtMillis,
    leasedAtMillis: metadata.leasedAtMillis,
    leaseExpiresAtMillis: metadata.leaseExpiresAtMillis,
  };
}

function previewTeamServerMetadataToJson(metadata: PreviewPoolMetadata): Prisma.InputJsonObject {
  return {
    [PREVIEW_POOL_METADATA_KEY]: previewPoolMetadataToJson(metadata),
  };
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return getNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parsePreviewPoolMetadata(value: unknown): PreviewPoolMetadata | null {
  if (!isRecord(value)) return null;
  const rawMetadata = value[PREVIEW_POOL_METADATA_KEY];
  if (!isRecord(rawMetadata)) return null;

  const version = rawMetadata.version;
  const state = rawMetadata.state;
  const projectId = getString(rawMetadata.projectId);
  const userId = getString(rawMetadata.userId);
  const createdAtMillis = getNumber(rawMetadata.createdAtMillis);
  const leasedAtMillis = getNullableNumber(rawMetadata.leasedAtMillis);
  const leaseExpiresAtMillis = getNullableNumber(rawMetadata.leaseExpiresAtMillis);

  if (
    version !== 1 ||
    (state !== "ready" && state !== "leased") ||
    projectId == null ||
    userId == null ||
    createdAtMillis == null
  ) {
    return null;
  }

  return {
    version,
    state,
    projectId,
    userId,
    createdAtMillis,
    leasedAtMillis,
    leaseExpiresAtMillis,
  };
}

async function getInternalTenancy(): Promise<Tenancy> {
  return await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
}

async function getPreviewOwnerTeamId(options: {
  internalTenancy: Tenancy,
  internalPrisma: PrismaClientTransaction,
  user: UsersCrud["Admin"]["Read"],
}): Promise<string> {
  const selectedMembership = await options.internalPrisma.teamMember.findFirst({
    where: {
      tenancyId: options.internalTenancy.id,
      projectUserId: options.user.id,
      isSelected: BooleanTrue.TRUE,
    },
    select: {
      teamId: true,
    },
  });
  if (selectedMembership != null) {
    return selectedMembership.teamId;
  }

  const existingMembership = await options.internalPrisma.teamMember.findFirst({
    where: {
      tenancyId: options.internalTenancy.id,
      projectUserId: options.user.id,
    },
    select: {
      teamId: true,
    },
  });
  if (existingMembership != null) {
    await options.internalPrisma.teamMember.update({
      where: {
        tenancyId_projectUserId_teamId: {
          tenancyId: options.internalTenancy.id,
          projectUserId: options.user.id,
          teamId: existingMembership.teamId,
        },
      },
      data: {
        isSelected: BooleanTrue.TRUE,
      },
    });
    return existingMembership.teamId;
  }

  const team = await teamsCrudHandlers.adminCreate({
    tenancy: options.internalTenancy,
    user: options.user,
    data: {
      display_name: "Preview Demo Lease",
      creator_user_id: "me",
    },
  });

  await options.internalPrisma.teamMember.update({
    where: {
      tenancyId_projectUserId_teamId: {
        tenancyId: options.internalTenancy.id,
        projectUserId: options.user.id,
        teamId: team.id,
      },
    },
    data: {
      isSelected: BooleanTrue.TRUE,
    },
  });

  return team.id;
}

async function createPreviewPoolProject(state: PreviewPoolState): Promise<{ projectId: string, userId: string, teamId: string }> {
  assertPreviewModeEnabled();

  const internalTenancy = await getInternalTenancy();
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const id = generateUuid();
  const user = await usersCrudHandlers.adminCreate({
    tenancy: internalTenancy,
    data: {
      display_name: "Preview Visitor",
      primary_email: `preview-pool-${id}@preview.stack-auth.com`,
      primary_email_verified: true,
      primary_email_auth_enabled: false,
      server_metadata: {
        [PREVIEW_POOL_METADATA_KEY]: {
          version: 1,
        },
      },
    },
  });
  const teamId = await getPreviewOwnerTeamId({
    internalTenancy,
    internalPrisma,
    user,
  });

  const clickhouseClient = getClickhouseAdminClient();
  const projectId = await seedDummyProject({
    ownerTeamId: teamId,
    oauthProviderIds: ['github', 'google', 'microsoft', 'spotify'],
    excludeAlphaApps: true,
    skipGithubConfigSource: true,
    clickhouseClient,
  });

  const now = new Date().getTime();
  const metadata: PreviewPoolMetadata = {
    version: 1,
    state,
    projectId,
    userId: user.id,
    createdAtMillis: now,
    leasedAtMillis: state === "leased" ? now : null,
    leaseExpiresAtMillis: state === "leased" ? now + getLeaseDurationMs() : null,
  };

  await internalPrisma.team.update({
    where: {
      tenancyId_teamId: {
        tenancyId: internalTenancy.id,
        teamId,
      },
    },
    data: {
      serverMetadata: previewTeamServerMetadataToJson(metadata),
    },
  });

  return { projectId, userId: user.id, teamId };
}

async function countReadyPreviewPoolProjects(): Promise<number> {
  assertPreviewModeEnabled();

  const internalTenancy = await getInternalTenancy();
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  return await internalPrisma.team.count({
    where: {
      tenancyId: internalTenancy.id,
      serverMetadata: {
        path: [PREVIEW_POOL_METADATA_KEY, "state"],
        equals: "ready",
      },
    },
  });
}

async function claimReadyPreviewPoolProject(): Promise<{ projectId: string, userId: string } | null> {
  assertPreviewModeEnabled();

  const internalTenancy = await getInternalTenancy();
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const readyTeams = await internalPrisma.team.findMany({
    where: {
      tenancyId: internalTenancy.id,
      serverMetadata: {
        path: [PREVIEW_POOL_METADATA_KEY, "state"],
        equals: "ready",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 5,
  });

  for (const team of readyTeams) {
    const metadata = parsePreviewPoolMetadata(team.serverMetadata);
    if (metadata == null || metadata.state !== "ready") {
      continue;
    }

    const now = new Date().getTime();
    const leasedMetadata: PreviewPoolMetadata = {
      ...metadata,
      state: "leased",
      leasedAtMillis: now,
      leaseExpiresAtMillis: now + getLeaseDurationMs(),
    };
    const updateResult = await internalPrisma.team.updateMany({
      where: {
        tenancyId: internalTenancy.id,
        teamId: team.teamId,
        serverMetadata: {
          path: [PREVIEW_POOL_METADATA_KEY, "state"],
          equals: "ready",
        },
      },
      data: {
        serverMetadata: previewTeamServerMetadataToJson(leasedMetadata),
      },
    });
    if (updateResult.count === 1) {
      return {
        projectId: metadata.projectId,
        userId: metadata.userId,
      };
    }
  }

  return null;
}

async function getTablesWithColumn(columnName: "projectId" | "tenancyId"): Promise<TableWithColumn[]> {
  return await globalPrismaClient.$queryRaw<TableWithColumn[]>`
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = ${columnName}
    ORDER BY table_name
  `;
}

async function deleteRowsByColumn(options: {
  columnName: "projectId" | "tenancyId",
  values: string[],
  excludedTables?: Set<string>,
}) {
  if (options.values.length === 0) return;

  const tables = await getTablesWithColumn(options.columnName);
  const remainingTables = new Map(
    tables
      .filter((table) => !(options.excludedTables?.has(table.table_name) ?? false))
      .map((table) => [`${table.table_schema}.${table.table_name}`, table]),
  );

  for (let pass = 0; pass < 8 && remainingTables.size > 0; pass++) {
    let resolvedTableCount = 0;
    for (const [key, table] of remainingTables) {
      try {
        await globalPrismaClient.$executeRaw(Prisma.sql`
          DELETE FROM ${sqlQuoteIdent(table.table_schema)}.${sqlQuoteIdent(table.table_name)}
          WHERE ${sqlQuoteIdent(options.columnName)} IN (${Prisma.join(options.values)})
        `);
        remainingTables.delete(key);
        resolvedTableCount++;
      } catch (error) {
        if (!isPrismaError(error, "FOREIGN_CONSTRAINT_VIOLATION")) {
          throw error;
        }
      }
    }

    if (resolvedTableCount === 0) {
      break;
    }
  }

  if (remainingTables.size > 0) {
    throw new Error(`Could not delete preview rows by ${options.columnName}; remaining tables: ${[...remainingTables.keys()].join(", ")}`);
  }
}

async function deletePreviewClickhouseEvents(projectId: string): Promise<void> {
  if (getEnvVariable("STACK_CLICKHOUSE_URL", "") === "") {
    return;
  }

  await getClickhouseAdminClient().command({
    query: "DELETE FROM analytics_internal.events WHERE project_id = {projectId:String}",
    query_params: { projectId },
  });
}

async function deletePreviewProjectData(projectId: string): Promise<void> {
  const tenancies = await globalPrismaClient.tenancy.findMany({
    where: {
      projectId,
    },
    select: {
      id: true,
    },
  });
  const tenancyIds = tenancies.map((tenancy) => tenancy.id);

  await deletePreviewClickhouseEvents(projectId);
  await deleteRowsByColumn({ columnName: "tenancyId", values: tenancyIds });
  await deleteRowsByColumn({
    columnName: "projectId",
    values: [projectId],
    excludedTables: new Set(["Project"]),
  });
  await globalPrismaClient.project.deleteMany({
    where: {
      id: projectId,
    },
  });
}

async function deletePreviewInternalLeaseIdentity(options: {
  internalTenancy: Tenancy,
  internalPrisma: PrismaClientTransaction,
  teamId: string,
  userId: string,
}) {
  await options.internalPrisma.team.deleteMany({
    where: {
      tenancyId: options.internalTenancy.id,
      teamId: options.teamId,
    },
  });
  await options.internalPrisma.projectUser.deleteMany({
    where: {
      tenancyId: options.internalTenancy.id,
      projectUserId: options.userId,
    },
  });
}

export async function cleanupExpiredPreviewPoolLeases(options?: { maxDelete?: number }): Promise<{
  deletedCount: number,
}> {
  assertPreviewModeEnabled();

  const internalTenancy = await getInternalTenancy();
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const maxDelete = options?.maxDelete ?? getCleanupMaxDeletePerRun();
  if (maxDelete <= 0) {
    return { deletedCount: 0 };
  }

  const leasedTeams = await internalPrisma.team.findMany({
    where: {
      tenancyId: internalTenancy.id,
      serverMetadata: {
        path: [PREVIEW_POOL_METADATA_KEY, "state"],
        equals: "leased",
      },
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: Math.max(maxDelete * 5, maxDelete),
  });

  const now = new Date().getTime();
  let deletedCount = 0;
  for (const team of leasedTeams) {
    if (deletedCount >= maxDelete) {
      break;
    }

    const metadata = parsePreviewPoolMetadata(team.serverMetadata);
    if (
      metadata == null ||
      metadata.state !== "leased" ||
      metadata.leaseExpiresAtMillis == null ||
      metadata.leaseExpiresAtMillis > now
    ) {
      continue;
    }

    await deletePreviewProjectData(metadata.projectId);
    await deletePreviewInternalLeaseIdentity({
      internalTenancy,
      internalPrisma,
      teamId: team.teamId,
      userId: metadata.userId,
    });
    deletedCount++;
  }

  return { deletedCount };
}

export async function fillPreviewPool(options?: { maxCreate?: number }): Promise<{
  readyCountBefore: number,
  createdCount: number,
  targetReadyCount: number,
}> {
  assertPreviewModeEnabled();

  const targetReadyCount = getReadyPoolSize();
  const readyCountBefore = await countReadyPreviewPoolProjects();
  const requestedMaxCreate = options?.maxCreate ?? 1;
  const createCount = Math.max(0, Math.min(requestedMaxCreate, targetReadyCount - readyCountBefore));

  for (let i = 0; i < createCount; i++) {
    await createPreviewPoolProject("ready");
  }

  return {
    readyCountBefore,
    createdCount: createCount,
    targetReadyCount,
  };
}

export async function claimPreviewPoolLease(): Promise<PreviewPoolLease> {
  assertPreviewModeEnabled();

  const claimed = await claimReadyPreviewPoolProject() ?? await createPreviewPoolProject("leased");
  const internalTenancy = await getInternalTenancy();

  await refreshDummyProjectLiveTokenRefreshEvents(claimed.projectId, getClickhouseAdminClient());
  const { accessToken, refreshToken } = await createAuthTokens({
    tenancy: internalTenancy,
    projectUserId: claimed.userId,
  });

  return {
    projectId: claimed.projectId,
    userId: claimed.userId,
    accessToken,
    refreshToken,
  };
}

export async function getPreviewPoolProjectForUser(userId: string): Promise<string | null> {
  assertPreviewModeEnabled();

  const internalTenancy = await getInternalTenancy();
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const membership = await internalPrisma.teamMember.findFirst({
    where: {
      tenancyId: internalTenancy.id,
      projectUserId: userId,
      team: {
        serverMetadata: {
          path: [PREVIEW_POOL_METADATA_KEY, "state"],
          equals: "leased",
        },
      },
    },
    include: {
      team: true,
    },
  });

  const metadata = parsePreviewPoolMetadata(membership?.team.serverMetadata);
  return metadata?.projectId ?? null;
}
