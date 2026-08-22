import {
  ReleaseArtifactStatus as PrismaReleaseArtifactStatus,
  ReleaseStatus as PrismaReleaseStatus,
  type ReleaseArtifactStatus as PrismaReleaseArtifactStatusValue,
  type ReleaseStatus as PrismaReleaseStatusValue,
} from "@/generated/prisma/enums";
import type {
  Prisma,
  Release,
  ReleaseArtifact,
  ReleaseArtifactDebugId,
  ReleaseCommit,
  ReleaseDeployment,
} from "@/generated/prisma/client";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, type PrismaClientTransaction } from "@/prisma-client";
import { anyVersionUuidPattern as UUID_PATTERN } from "@hexclave/shared/dist/utils/uuids";
import { DEBUG_ID_RE } from "../artifacts/artifact-manifest";

const RELEASE_VERSION_MAX_BYTES = 250;
const RELEASE_REF_MAX_BYTES = 250;
const DEPLOYMENT_KEY_MAX_BYTES = 256;
const ENVIRONMENT_MAX_BYTES = 255;
const REPOSITORY_MAX_BYTES = 256;
const COMMIT_SHA_MAX_BYTES = 128;
const RELEASE_JSON_MAX_BYTES = 64 * 1024;
const RELEASE_JSON_MAX_DEPTH = 6;
const RELEASE_JSON_MAX_STRING_BYTES = 8 * 1024;
const RELEASE_JSON_MAX_KEY_BYTES = 256;
const RELEASE_JSON_MAX_COLLECTION_ENTRIES = 100;
const MAX_DATABASE_INT = 2_147_483_647;
const LOOKUP_LIMIT = 100;
const DEFAULT_RELEASE_LIST_LIMIT = 50;
const MAX_RELEASE_LIST_LIMIT = 100;
const RELEASE_GRAPH_LIST_LIMIT = 50;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const RELEASE_STATUSES = [
  PrismaReleaseStatus.OPEN,
  PrismaReleaseStatus.ARCHIVED,
] as const;
export type ReleaseStatusValue = PrismaReleaseStatusValue;

export const RELEASE_ARTIFACT_STATUSES = [
  PrismaReleaseArtifactStatus.REGISTERED,
  PrismaReleaseArtifactStatus.FINALIZED,
] as const;
export type ReleaseArtifactStatusValue = PrismaReleaseArtifactStatusValue;

export type ReleaseScopeTenancy = Pick<Tenancy, "id" | "branchId"> & {
  project: Pick<Tenancy["project"], "id">,
};

export type ReleaseScope = {
  tenancy: ReleaseScopeTenancy,
};

export type ReleaseArtifactLookupRow = Prisma.ReleaseArtifactDebugIdGetPayload<{
  include: { releaseArtifact: { include: { release: true } } },
}>;

export type ReleaseDatabase = {
  release: {
    findMany(args: Prisma.ReleaseFindManyArgs): Promise<Release[]>,
    findUnique(args: Prisma.ReleaseFindUniqueArgs): Promise<Release | null>,
    upsert(args: Prisma.ReleaseUpsertArgs): Promise<Release>,
  },
  releaseDeployment: {
    findMany(args: Prisma.ReleaseDeploymentFindManyArgs): Promise<ReleaseDeployment[]>,
    findUnique(args: Prisma.ReleaseDeploymentFindUniqueArgs): Promise<ReleaseDeployment | null>,
    upsert(args: Prisma.ReleaseDeploymentUpsertArgs): Promise<ReleaseDeployment>,
    update(args: Prisma.ReleaseDeploymentUpdateArgs): Promise<ReleaseDeployment>,
  },
  releaseCommit: {
    findMany(args: Prisma.ReleaseCommitFindManyArgs): Promise<ReleaseCommit[]>,
    upsert(args: Prisma.ReleaseCommitUpsertArgs): Promise<ReleaseCommit>,
  },
  releaseArtifact: {
    findUnique(args: Prisma.ReleaseArtifactFindUniqueArgs): Promise<ReleaseArtifact | null>,
    upsert(args: Prisma.ReleaseArtifactUpsertArgs): Promise<ReleaseArtifact>,
  },
    releaseArtifactDebugId: {
      upsert(args: Prisma.ReleaseArtifactDebugIdUpsertArgs): Promise<ReleaseArtifactDebugId>,
      findMany(args: Omit<Prisma.ReleaseArtifactDebugIdFindManyArgs, "select" | "include">): Promise<ReleaseArtifactLookupRow[]>,
  },
};

export type UpsertReleaseInput = {
  version: string,
  status?: ReleaseStatusValue,
  ref?: string,
  url?: string,
  data?: unknown,
  dateAdded?: Date,
  dateStarted?: Date | null,
  dateReleased?: Date | null,
};

export type UpsertReleaseDeploymentInput = {
  releaseId: string,
  deploymentKey: string,
  environment: string,
  name?: string,
  url?: string,
  startedAt?: Date | null,
  finishedAt?: Date,
  metadata?: unknown,
};

export type UpsertReleaseCommitInput = {
  releaseId: string,
  repository: string,
  commitSha: string,
  position: number,
  message?: string,
  authorName?: string,
  authorEmail?: string,
  committedAt?: Date | null,
  url?: string,
};

export type UpsertReleaseArtifactInput = {
  releaseId: string,
  manifestSha256: string,
  dist?: string,
  environment?: string,
  status?: ReleaseArtifactStatusValue,
  manifestObjectKey?: string,
  finalizedAt?: Date | null,
};

export type UpsertReleaseArtifactDebugIdInput = {
  releaseArtifactId: string,
  debugId: string,
  codeFile: string,
  sourceMapFile: string | null,
  sourceMapInline: boolean,
  bundleSha256: string,
  bundleBytes: number,
  sourceMapSha256: string,
  sourceMapBytes: number,
  sourceMapGzippedBytes: number,
  bundleObjectKey?: string,
  sourceMapObjectKey?: string | null,
};

export type ReleaseArtifactLookup = {
  release: Release,
  artifact: ReleaseArtifact,
  debugId: ReleaseArtifactDebugId,
};

export type ReleaseList = {
  items: Release[],
  truncated: boolean,
};

export type ReleaseDetail = {
  release: Release,
  commits: ReleaseCommit[],
  deployments: ReleaseDeployment[],
};

export class ReleaseInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReleaseInputError";
  }
}

export class ReleaseNotFoundError extends Error {
  public readonly tenancyId: string;
  public readonly releaseId: string;

  public constructor(scope: ReleaseScope, releaseId: string) {
    super(`Release ${releaseId} was not found in tenancy ${scope.tenancy.id}.`);
    this.name = "ReleaseNotFoundError";
    this.tenancyId = scope.tenancy.id;
    this.releaseId = releaseId;
  }
}

export class ReleaseArtifactNotFoundError extends Error {
  public readonly tenancyId: string;
  public readonly releaseArtifactId: string;

  public constructor(scope: ReleaseScope, releaseArtifactId: string) {
    super(`Release artifact ${releaseArtifactId} was not found in tenancy ${scope.tenancy.id}.`);
    this.name = "ReleaseArtifactNotFoundError";
    this.tenancyId = scope.tenancy.id;
    this.releaseArtifactId = releaseArtifactId;
  }
}

export class ReleaseScopeInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReleaseScopeInvariantError";
  }
}

export function releaseScopeFields(scope: ReleaseScope): {
  tenancyId: string,
  projectId: string,
  branchId: string,
} {
  const tenancyId = validateUuid(scope.tenancy.id, "tenancy.id");
  const projectId = validateText(scope.tenancy.project.id, "tenancy.project.id", 512);
  const branchId = validateText(scope.tenancy.branchId, "tenancy.branchId", 512);
  return { tenancyId, projectId, branchId };
}

export function validateReleaseVersion(value: string): string {
  const version = validateText(value, "release version", RELEASE_VERSION_MAX_BYTES);
  if (version === "." || version === ".." || version.toLowerCase() === "latest") {
    throw new ReleaseInputError("release version must not be '.', '..', or 'latest'");
  }
  return version;
}

export function validateSha256(value: string, fieldName: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new ReleaseInputError(`${fieldName} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function validateDebugId(value: string): string {
  if (!DEBUG_ID_RE.test(value)) {
    throw new ReleaseInputError("debugId must be a lowercase hyphenated UUID");
  }
  return value;
}

export function validateReleaseJson(value: unknown, fieldName: string): Prisma.InputJsonValue {
  const activeObjects = new WeakSet<object>();
  const normalized = normalizeReleaseJson(value, fieldName, 0, activeObjects);
  if (normalized === null) {
    throw new ReleaseInputError(`${fieldName} must be a non-null JSON value`);
  }
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > RELEASE_JSON_MAX_BYTES) {
    throw new ReleaseInputError(`${fieldName} exceeds the ${RELEASE_JSON_MAX_BYTES}-byte limit`);
  }
  return normalized;
}

export class ReleaseService {
  public constructor(private readonly database?: ReleaseDatabase) {}

  public async getRelease(scope: ReleaseScope, version: string): Promise<Release | null> {
    const fields = releaseScopeFields(scope);
    const db = await this.resolveDatabase(scope);
    const release = await db.release.findUnique({
      where: {
        tenancyId_version: {
          tenancyId: fields.tenancyId,
          version: validateReleaseVersion(version),
        },
      },
    });
    if (release === null) return null;
    return release.tenancyId === fields.tenancyId
      && release.projectId === fields.projectId
      && release.branchId === fields.branchId
      ? release
      : null;
  }

  public async getReleaseDetail(scope: ReleaseScope, version: string): Promise<ReleaseDetail | null> {
    const release = await this.getRelease(scope, version);
    if (release === null) return null;
    const fields = releaseScopeFields(scope);
    const db = await this.resolveDatabase(scope);
    const [commits, deployments] = await Promise.all([
      db.releaseCommit.findMany({
        where: { tenancyId: fields.tenancyId, releaseId: release.id },
        orderBy: { position: "asc" },
        take: RELEASE_GRAPH_LIST_LIMIT,
      }),
      db.releaseDeployment.findMany({
        where: { tenancyId: fields.tenancyId, releaseId: release.id },
        orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
        take: RELEASE_GRAPH_LIST_LIMIT,
      }),
    ]);
    for (const commit of commits) assertGraphRowScope(scope, release, commit);
    for (const deployment of deployments) assertGraphRowScope(scope, release, deployment);
    return { release, commits, deployments };
  }

  public async listReleases(
    scope: ReleaseScope,
    input: { limit?: number },
  ): Promise<ReleaseList> {
    const fields = releaseScopeFields(scope);
    const limit = input.limit ?? DEFAULT_RELEASE_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RELEASE_LIST_LIMIT) {
      throw new ReleaseInputError(`release list limit must be an integer between 1 and ${MAX_RELEASE_LIST_LIMIT}`);
    }

    const db = await this.resolveDatabase(scope);
    const rows = await db.release.findMany({
      where: fields,
      orderBy: [{ dateAdded: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    for (const release of rows) assertReleaseScope(scope, release);
    const items = rows.slice(0, limit);
    return {
      items,
      truncated: rows.length > limit,
    };
  }

  public async upsertRelease(scope: ReleaseScope, input: UpsertReleaseInput): Promise<Release> {
    const fields = releaseScopeFields(scope);
    const version = validateReleaseVersion(input.version);
    const status = input.status === undefined ? PrismaReleaseStatus.OPEN : input.status;
    validateReleaseStatus(status);
    validateOptionalUrl(input.url, "release url");
    validateOptionalDate(input.dateAdded, "dateAdded");
    validateOptionalDate(input.dateStarted, "dateStarted");
    validateOptionalDate(input.dateReleased, "dateReleased");
    if (input.ref !== undefined) validateText(input.ref, "release ref", RELEASE_REF_MAX_BYTES);
    const data = input.data === undefined ? undefined : validateReleaseJson(input.data, "release data");

    const db = await this.resolveDatabase(scope);
    const existing = await db.release.findUnique({
      where: { tenancyId_version: { tenancyId: fields.tenancyId, version } },
    });
    if (existing !== null) assertReleaseScope(scope, existing);
    const release = await db.release.upsert({
      where: { tenancyId_version: { tenancyId: fields.tenancyId, version } },
      create: {
        ...fields,
        version,
        status,
        ...(input.ref === undefined ? {} : { ref: input.ref }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(data === undefined ? {} : { data }),
        ...(input.dateAdded === undefined ? {} : { dateAdded: input.dateAdded }),
        ...(input.dateStarted === undefined ? {} : { dateStarted: input.dateStarted }),
        ...(input.dateReleased === undefined ? {} : { dateReleased: input.dateReleased }),
      },
      update: {
        status,
        ...(input.ref === undefined ? {} : { ref: input.ref }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(data === undefined ? {} : { data }),
        ...(input.dateStarted === undefined ? {} : { dateStarted: input.dateStarted }),
        ...(input.dateReleased === undefined ? {} : { dateReleased: input.dateReleased }),
      },
    });
    assertReleaseScope(scope, release);
    return release;
  }

  public async upsertDeployment(
    scope: ReleaseScope,
    input: UpsertReleaseDeploymentInput,
  ): Promise<ReleaseDeployment> {
    const fields = releaseScopeFields(scope);
    const releaseId = validateUuid(input.releaseId, "releaseId");
    await this.requireRelease(scope, releaseId);
    const deploymentKey = validateText(input.deploymentKey, "deploymentKey", DEPLOYMENT_KEY_MAX_BYTES);
    const environment = validateText(input.environment, "environment", ENVIRONMENT_MAX_BYTES);
    if (input.name !== undefined) validateText(input.name, "deployment name", 64);
    validateOptionalUrl(input.url, "deployment url");
    validateOptionalDate(input.startedAt, "startedAt");
    validateOptionalDate(input.finishedAt, "finishedAt");
    const metadata = input.metadata === undefined
      ? undefined
      : validateReleaseJson(input.metadata, "deployment metadata");
    const mutableFields: Prisma.ReleaseDeploymentUpdateInput = {
      environment,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
      ...(metadata === undefined ? {} : { metadata }),
    };

    const db = await this.resolveDatabase(scope);
    const existing = await db.releaseDeployment.findUnique({
      where: { tenancyId_deploymentKey: { tenancyId: fields.tenancyId, deploymentKey } },
    });
    if (existing !== null && (existing.projectId !== fields.projectId || existing.branchId !== fields.branchId || existing.releaseId !== releaseId)) {
      throw new ReleaseScopeInvariantError(`deploymentKey ${deploymentKey} is already attached to a different release scope`);
    }

    const deployment = await db.releaseDeployment.upsert({
      where: { tenancyId_deploymentKey: { tenancyId: fields.tenancyId, deploymentKey } },
      create: {
        ...fields,
        releaseId,
        deploymentKey,
        environment,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
        ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
        ...(metadata === undefined ? {} : { metadata }),
      },
      update: {},
    });
    if (deployment.projectId !== fields.projectId
      || deployment.branchId !== fields.branchId
      || deployment.releaseId !== releaseId) {
      throw new ReleaseScopeInvariantError(`deploymentKey ${deploymentKey} is already attached to a different release scope`);
    }
    return await db.releaseDeployment.update({
      where: { tenancyId_id: { tenancyId: fields.tenancyId, id: deployment.id } },
      data: mutableFields,
    });
  }

  public async upsertCommit(scope: ReleaseScope, input: UpsertReleaseCommitInput): Promise<ReleaseCommit> {
    const fields = releaseScopeFields(scope);
    const releaseId = validateUuid(input.releaseId, "releaseId");
    await this.requireRelease(scope, releaseId);
    const repository = validateText(input.repository, "repository", REPOSITORY_MAX_BYTES);
    const commitSha = validateText(input.commitSha, "commitSha", COMMIT_SHA_MAX_BYTES);
    if (!Number.isSafeInteger(input.position) || input.position < 0) {
      throw new ReleaseInputError("commit position must be a non-negative safe integer");
    }
    if (input.position > MAX_DATABASE_INT) {
      throw new ReleaseInputError("commit position exceeds the database integer range");
    }
    if (input.message !== undefined) validateMultilineText(input.message, "commit message", 100_000);
    if (input.authorName !== undefined) validateText(input.authorName, "commit author name", 256);
    if (input.authorEmail !== undefined) validateText(input.authorEmail, "commit author email", 320);
    validateOptionalUrl(input.url, "commit url");
    validateOptionalDate(input.committedAt, "committedAt");

    const db = await this.resolveDatabase(scope);
    return await db.releaseCommit.upsert({
      where: {
        tenancyId_releaseId_repository_commitSha: {
          tenancyId: fields.tenancyId,
          releaseId,
          repository,
          commitSha,
        },
      },
      create: {
        ...fields,
        releaseId,
        repository,
        commitSha,
        position: input.position,
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.authorName === undefined ? {} : { authorName: input.authorName }),
        ...(input.authorEmail === undefined ? {} : { authorEmail: input.authorEmail }),
        ...(input.committedAt === undefined ? {} : { committedAt: input.committedAt }),
        ...(input.url === undefined ? {} : { url: input.url }),
      },
      update: {
        position: input.position,
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.authorName === undefined ? {} : { authorName: input.authorName }),
        ...(input.authorEmail === undefined ? {} : { authorEmail: input.authorEmail }),
        ...(input.committedAt === undefined ? {} : { committedAt: input.committedAt }),
        ...(input.url === undefined ? {} : { url: input.url }),
      },
    });
  }

  public async upsertArtifact(
    scope: ReleaseScope,
    input: UpsertReleaseArtifactInput,
  ): Promise<ReleaseArtifact> {
    const fields = releaseScopeFields(scope);
    const releaseId = validateUuid(input.releaseId, "releaseId");
    await this.requireRelease(scope, releaseId);
    const manifestSha256 = validateSha256(input.manifestSha256, "manifestSha256");
    const status = input.status === undefined ? PrismaReleaseArtifactStatus.REGISTERED : input.status;
    validateArtifactStatus(status);
    if (input.dist !== undefined) validateText(input.dist, "dist", 64);
    if (input.environment !== undefined) validateText(input.environment, "environment", ENVIRONMENT_MAX_BYTES);
    if (input.manifestObjectKey !== undefined) validateText(input.manifestObjectKey, "manifestObjectKey", 4_096);
    validateOptionalDate(input.finalizedAt, "finalizedAt");

    const db = await this.resolveDatabase(scope);
    const where = {
      tenancyId_releaseId_manifestSha256: {
        tenancyId: fields.tenancyId,
        releaseId,
        manifestSha256,
      },
    };
    return await db.releaseArtifact.upsert({
      where,
      create: {
        ...fields,
        releaseId,
        manifestSha256,
        status,
        ...(input.dist === undefined ? {} : { dist: input.dist }),
        ...(input.environment === undefined ? {} : { environment: input.environment }),
        ...(input.manifestObjectKey === undefined ? {} : { manifestObjectKey: input.manifestObjectKey }),
        ...(input.finalizedAt === undefined ? {} : { finalizedAt: input.finalizedAt }),
      },
      update: {
        ...(status === PrismaReleaseArtifactStatus.FINALIZED ? { status: PrismaReleaseArtifactStatus.FINALIZED } : {}),
        ...(input.dist === undefined ? {} : { dist: input.dist }),
        ...(input.environment === undefined ? {} : { environment: input.environment }),
        ...(input.manifestObjectKey === undefined ? {} : { manifestObjectKey: input.manifestObjectKey }),
        ...(input.finalizedAt === undefined ? {} : { finalizedAt: input.finalizedAt }),
      },
    });
  }

  public async upsertArtifactDebugId(
    scope: ReleaseScope,
    input: UpsertReleaseArtifactDebugIdInput,
  ): Promise<ReleaseArtifactDebugId> {
    const fields = releaseScopeFields(scope);
    const releaseArtifactId = validateUuid(input.releaseArtifactId, "releaseArtifactId");
    await this.requireArtifact(scope, releaseArtifactId);
    const debugId = validateDebugId(input.debugId);
    const codeFile = validateText(input.codeFile, "codeFile", 1_024);
    if (input.sourceMapFile !== null) validateText(input.sourceMapFile, "sourceMapFile", 1_024);
    if (input.sourceMapInline !== (input.sourceMapFile === null)) {
      throw new ReleaseInputError("sourceMapInline must match whether sourceMapFile is null");
    }
    if (input.sourceMapInline && input.sourceMapObjectKey !== undefined && input.sourceMapObjectKey !== null) {
      throw new ReleaseInputError("inline source maps must not have a sourceMapObjectKey");
    }
    const bundleSha256 = validateSha256(input.bundleSha256, "bundleSha256");
    const sourceMapSha256 = validateSha256(input.sourceMapSha256, "sourceMapSha256");
    validateByteSize(input.bundleBytes, "bundleBytes");
    validateByteSize(input.sourceMapBytes, "sourceMapBytes");
    validateByteSize(input.sourceMapGzippedBytes, "sourceMapGzippedBytes");
    if (input.bundleObjectKey !== undefined) validateText(input.bundleObjectKey, "bundleObjectKey", 4_096);
    if (input.sourceMapObjectKey !== undefined && input.sourceMapObjectKey !== null) {
      validateText(input.sourceMapObjectKey, "sourceMapObjectKey", 4_096);
    }

    const db = await this.resolveDatabase(scope);
    const where = {
      tenancyId_releaseArtifactId_debugId: {
        tenancyId: fields.tenancyId,
        releaseArtifactId,
        debugId,
      },
    };
    return await db.releaseArtifactDebugId.upsert({
      where,
      create: {
        ...fields,
        releaseArtifactId,
        debugId,
        codeFile,
        sourceMapFile: input.sourceMapFile,
        sourceMapInline: input.sourceMapInline,
        bundleSha256,
        bundleBytes: input.bundleBytes,
        sourceMapSha256,
        sourceMapBytes: input.sourceMapBytes,
        sourceMapGzippedBytes: input.sourceMapGzippedBytes,
        ...(input.bundleObjectKey === undefined ? {} : { bundleObjectKey: input.bundleObjectKey }),
        ...(input.sourceMapObjectKey === undefined ? {} : { sourceMapObjectKey: input.sourceMapObjectKey }),
      },
      update: {
        codeFile,
        sourceMapFile: input.sourceMapFile,
        sourceMapInline: input.sourceMapInline,
        bundleSha256,
        bundleBytes: input.bundleBytes,
        sourceMapSha256,
        sourceMapBytes: input.sourceMapBytes,
        sourceMapGzippedBytes: input.sourceMapGzippedBytes,
        ...(input.bundleObjectKey === undefined ? {} : { bundleObjectKey: input.bundleObjectKey }),
        ...(input.sourceMapObjectKey === undefined ? {} : { sourceMapObjectKey: input.sourceMapObjectKey }),
      },
    });
  }

  public async lookupArtifactDebugId(
    scope: ReleaseScope,
    input: { debugId: string, releaseVersion?: string, dist?: string, environment?: string },
  ): Promise<ReleaseArtifactLookup[]> {
    const fields = releaseScopeFields(scope);
    const debugId = validateDebugId(input.debugId);
    const releaseVersion = input.releaseVersion === undefined ? undefined : validateReleaseVersion(input.releaseVersion);
    if (input.dist !== undefined) validateText(input.dist, "dist", 64);
    if (input.environment !== undefined) validateText(input.environment, "environment", ENVIRONMENT_MAX_BYTES);

    const db = await this.resolveDatabase(scope);
    const rows = await db.releaseArtifactDebugId.findMany({
      where: {
        tenancyId: fields.tenancyId,
        projectId: fields.projectId,
        branchId: fields.branchId,
        debugId,
        releaseArtifact: {
          is: {
            tenancyId: fields.tenancyId,
            projectId: fields.projectId,
            branchId: fields.branchId,
            ...(input.dist === undefined ? {} : { dist: input.dist }),
            ...(input.environment === undefined ? {} : { environment: input.environment }),
            ...(releaseVersion === undefined ? {} : { release: { is: { tenancyId: fields.tenancyId, version: releaseVersion } } }),
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: LOOKUP_LIMIT,
    });
    return rows.map((row) => ({
      release: row.releaseArtifact.release,
      artifact: row.releaseArtifact,
      debugId: row,
    }));
  }

  private async resolveDatabase(scope: ReleaseScope): Promise<ReleaseDatabase> {
    if (this.database !== undefined) return this.database;
    const tenancy = await getTenancy(scope.tenancy.id);
    if (tenancy === null) {
      throw new ReleaseScopeInvariantError(`tenancy ${scope.tenancy.id} was not found`);
    }
    const resolvedScope = releaseScopeFields({ tenancy });
    const requestedScope = releaseScopeFields(scope);
    if (resolvedScope.projectId !== requestedScope.projectId || resolvedScope.branchId !== requestedScope.branchId) {
      throw new ReleaseScopeInvariantError(`tenancy ${scope.tenancy.id} does not match the requested project branch`);
    }
    return adaptPrismaClient(await getPrismaClientForTenancy(tenancy));
  }

  private async requireRelease(scope: ReleaseScope, releaseId: string): Promise<Release> {
    const fields = releaseScopeFields(scope);
    const db = await this.resolveDatabase(scope);
    const release = await db.release.findUnique({
      where: { tenancyId_id: { tenancyId: fields.tenancyId, id: releaseId } },
    });
    if (release === null) throw new ReleaseNotFoundError(scope, releaseId);
    assertReleaseScope(scope, release);
    return release;
  }

  private async requireArtifact(scope: ReleaseScope, releaseArtifactId: string): Promise<ReleaseArtifact> {
    const fields = releaseScopeFields(scope);
    const db = await this.resolveDatabase(scope);
    const artifact = await db.releaseArtifact.findUnique({
      where: { tenancyId_id: { tenancyId: fields.tenancyId, id: releaseArtifactId } },
    });
    if (artifact === null) throw new ReleaseArtifactNotFoundError(scope, releaseArtifactId);
    if (artifact.projectId !== fields.projectId || artifact.branchId !== fields.branchId) {
      throw new ReleaseScopeInvariantError(`release artifact ${releaseArtifactId} is outside the requested project branch`);
    }
    return artifact;
  }
}

export const releaseService = new ReleaseService();

function adaptPrismaClient(client: PrismaClientTransaction): ReleaseDatabase {
  return {
    release: {
      findMany: async (args) => await client.release.findMany(args),
      findUnique: async (args) => await client.release.findUnique(args),
      upsert: async (args) => await client.release.upsert(args),
    },
    releaseDeployment: {
      findMany: async (args) => await client.releaseDeployment.findMany(args),
      findUnique: async (args) => await client.releaseDeployment.findUnique(args),
      upsert: async (args) => await client.releaseDeployment.upsert(args),
      update: async (args) => await client.releaseDeployment.update(args),
    },
    releaseCommit: {
      findMany: async (args) => await client.releaseCommit.findMany(args),
      upsert: async (args) => await client.releaseCommit.upsert(args),
    },
    releaseArtifact: {
      findUnique: async (args) => await client.releaseArtifact.findUnique(args),
      upsert: async (args) => await client.releaseArtifact.upsert(args),
    },
    releaseArtifactDebugId: {
      upsert: async (args) => await client.releaseArtifactDebugId.upsert(args),
      findMany: async (args) => await client.releaseArtifactDebugId.findMany({
        ...args,
        include: { releaseArtifact: { include: { release: true } } },
      }),
    },
  };
}

function assertReleaseScope(scope: ReleaseScope, release: Release): void {
  const fields = releaseScopeFields(scope);
  if (release.tenancyId !== fields.tenancyId || release.projectId !== fields.projectId || release.branchId !== fields.branchId) {
    throw new ReleaseScopeInvariantError(`release ${release.id} belongs to a different project branch`);
  }
}

function assertGraphRowScope(
  scope: ReleaseScope,
  release: Release,
  row: { tenancyId: string, projectId: string, branchId: string, releaseId: string, id: string },
): void {
  assertReleaseScope(scope, release);
  const fields = releaseScopeFields(scope);
  if (
    row.tenancyId !== fields.tenancyId
    || row.projectId !== fields.projectId
    || row.branchId !== fields.branchId
    || row.releaseId !== release.id
  ) {
    throw new ReleaseScopeInvariantError(`release graph row ${row.id} belongs to a different project branch`);
  }
}

function validateReleaseStatus(value: ReleaseStatusValue): void {
  if (!RELEASE_STATUSES.includes(value)) {
    throw new ReleaseInputError(`unsupported release status ${value}`);
  }
}

function validateArtifactStatus(value: ReleaseArtifactStatusValue): void {
  if (!RELEASE_ARTIFACT_STATUSES.includes(value)) {
    throw new ReleaseInputError(`unsupported release artifact status ${value}`);
  }
}

function validateUuid(value: string, fieldName: string): string {
  if (!UUID_PATTERN.test(value)) throw new ReleaseInputError(`${fieldName} must be a UUID`);
  return value;
}

function validateText(value: string, fieldName: string, maxBytes: number): string {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ReleaseInputError(`${fieldName} must be non-empty, bounded, and free of control characters`);
  }
  return value;
}

function validateMultilineText(value: string, fieldName: string, maxBytes: number): string {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new ReleaseInputError(`${fieldName} must be non-empty, bounded, and free of prohibited control characters`);
  }
  return value;
}

function validateOptionalUrl(value: string | undefined, fieldName: string): void {
  if (value === undefined) return;
  validateText(value, fieldName, 2_048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReleaseInputError(`${fieldName} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReleaseInputError(`${fieldName} must use http or https`);
  }
}

function validateOptionalDate(value: Date | null | undefined, fieldName: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value.getTime())) throw new ReleaseInputError(`${fieldName} must be a valid Date`);
}

function validateByteSize(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DATABASE_INT) {
    throw new ReleaseInputError(`${fieldName} must be a positive database-sized integer`);
  }
}

function normalizeReleaseJson(
  value: unknown,
  fieldName: string,
  depth: number,
  activeObjects: WeakSet<object>,
): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > RELEASE_JSON_MAX_STRING_BYTES) {
      throw new ReleaseInputError(`${fieldName} contains a string exceeding the ${RELEASE_JSON_MAX_STRING_BYTES}-byte limit`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ReleaseInputError(`${fieldName} contains a non-finite number`);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (depth >= RELEASE_JSON_MAX_DEPTH) {
    throw new ReleaseInputError(`${fieldName} exceeds the maximum JSON depth`);
  }
  if (typeof value !== "object") {
    throw new ReleaseInputError(`${fieldName} must contain only JSON values`);
  }
  if (activeObjects.has(value)) {
    throw new ReleaseInputError(`${fieldName} must not contain cyclic references`);
  }

  activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > RELEASE_JSON_MAX_COLLECTION_ENTRIES) {
        throw new ReleaseInputError(`${fieldName} contains too many array entries`);
      }
      return value.map((item) => normalizeReleaseJson(item, fieldName, depth + 1, activeObjects));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ReleaseInputError(`${fieldName} must contain only plain JSON objects`);
    }
    const entries = Object.entries(value);
    if (entries.length > RELEASE_JSON_MAX_COLLECTION_ENTRIES) {
      throw new ReleaseInputError(`${fieldName} contains too many object entries`);
    }
    const result: { [key: string]: Prisma.InputJsonValue | null } = {};
    for (const [key, item] of entries) {
      if (Buffer.byteLength(key, "utf8") > RELEASE_JSON_MAX_KEY_BYTES || /[\u0000-\u001f\u007f]/u.test(key)) {
        throw new ReleaseInputError(`${fieldName} contains an invalid object key`);
      }
      result[key] = normalizeReleaseJson(item, fieldName, depth + 1, activeObjects);
    }
    return result;
  } finally {
    activeObjects.delete(value);
  }
}
