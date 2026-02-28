import { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type ManagedEmailDomainStatus = "pending_dns" | "pending_verification" | "verified" | "applied" | "failed";

type ManagedEmailDomainRow = {
  id: string,
  tenancyId: string,
  projectId: string,
  branchId: string,
  subdomain: string,
  senderLocalPart: string,
  resendDomainId: string,
  nameServerRecords: unknown,
  status: "PENDING_DNS" | "PENDING_VERIFICATION" | "VERIFIED" | "APPLIED" | "FAILED",
  providerStatusRaw: string | null,
  isActive: boolean,
  lastError: string | null,
  verifiedAt: Date | null,
  appliedAt: Date | null,
  lastWebhookAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
};

export type ManagedEmailDomain = {
  id: string,
  tenancyId: string,
  projectId: string,
  branchId: string,
  subdomain: string,
  senderLocalPart: string,
  resendDomainId: string,
  nameServerRecords: string[],
  status: ManagedEmailDomainStatus,
  providerStatusRaw: string | null,
  isActive: boolean,
  lastError: string | null,
  verifiedAt: Date | null,
  appliedAt: Date | null,
  lastWebhookAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
};

function dbStatusToStatus(status: ManagedEmailDomainRow["status"]): ManagedEmailDomainStatus {
  if (status === "PENDING_DNS") return "pending_dns";
  if (status === "PENDING_VERIFICATION") return "pending_verification";
  if (status === "VERIFIED") return "verified";
  if (status === "APPLIED") return "applied";
  return "failed";
}

function statusToDbStatus(status: ManagedEmailDomainStatus): ManagedEmailDomainRow["status"] {
  if (status === "pending_dns") return "PENDING_DNS";
  if (status === "pending_verification") return "PENDING_VERIFICATION";
  if (status === "verified") return "VERIFIED";
  if (status === "applied") return "APPLIED";
  return "FAILED";
}

function parseNameServerRecords(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new StackAssertionError("ManagedEmailDomain.nameServerRecords stored invalid JSON", {
      nameServerRecords: value,
    });
  }
  return value;
}

function mapRow(row: ManagedEmailDomainRow): ManagedEmailDomain {
  return {
    id: row.id,
    tenancyId: row.tenancyId,
    projectId: row.projectId,
    branchId: row.branchId,
    subdomain: row.subdomain,
    senderLocalPart: row.senderLocalPart,
    resendDomainId: row.resendDomainId,
    nameServerRecords: parseNameServerRecords(row.nameServerRecords),
    status: dbStatusToStatus(row.status),
    providerStatusRaw: row.providerStatusRaw,
    isActive: row.isActive,
    lastError: row.lastError,
    verifiedAt: row.verifiedAt,
    appliedAt: row.appliedAt,
    lastWebhookAt: row.lastWebhookAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getManagedEmailDomainByTenancyAndSubdomain(options: {
  tenancyId: string,
  subdomain: string,
}): Promise<ManagedEmailDomain | null> {
  const rows = await globalPrismaClient.$queryRaw<ManagedEmailDomainRow[]>(Prisma.sql`
    SELECT *
    FROM "ManagedEmailDomain"
    WHERE "tenancyId" = ${options.tenancyId}
      AND "subdomain" = ${options.subdomain}
    LIMIT 1
  `);
  if (rows.length === 0) {
    return null;
  }
  return mapRow(rows[0]!);
}

export async function getManagedEmailDomainByResendDomainId(resendDomainId: string): Promise<ManagedEmailDomain | null> {
  const rows = await globalPrismaClient.$queryRaw<ManagedEmailDomainRow[]>(Prisma.sql`
    SELECT *
    FROM "ManagedEmailDomain"
    WHERE "resendDomainId" = ${resendDomainId}
    LIMIT 1
  `);
  if (rows.length === 0) {
    return null;
  }
  return mapRow(rows[0]!);
}

export async function createManagedEmailDomain(options: {
  tenancyId: string,
  projectId: string,
  branchId: string,
  subdomain: string,
  senderLocalPart: string,
  resendDomainId: string,
  nameServerRecords: string[],
  status: ManagedEmailDomainStatus,
}): Promise<ManagedEmailDomain> {
  const row = await globalPrismaClient.managedEmailDomain.create({
    data: {
      tenancyId: options.tenancyId,
      projectId: options.projectId,
      branchId: options.branchId,
      subdomain: options.subdomain,
      senderLocalPart: options.senderLocalPart,
      resendDomainId: options.resendDomainId,
      nameServerRecords: options.nameServerRecords,
      status: statusToDbStatus(options.status),
      isActive: true
    }
  });
  return mapRow(row);
}

export async function updateManagedEmailDomainWebhookStatus(options: {
  resendDomainId: string,
  providerStatusRaw: string,
  status: ManagedEmailDomainStatus,
  lastError: string | null,
}): Promise<ManagedEmailDomain | null> {
  const verifiedAt = options.status === "verified" ? Prisma.sql`CURRENT_TIMESTAMP` : Prisma.sql`"verifiedAt"`;
  const rows = await globalPrismaClient.$queryRaw<ManagedEmailDomainRow[]>(Prisma.sql`
    UPDATE "ManagedEmailDomain"
    SET
      "providerStatusRaw" = ${options.providerStatusRaw},
      "status" = ${statusToDbStatus(options.status)}::"ManagedEmailDomainStatus",
      "lastError" = ${options.lastError},
      "lastWebhookAt" = CURRENT_TIMESTAMP,
      "verifiedAt" = ${verifiedAt},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "resendDomainId" = ${options.resendDomainId}
      AND "isActive" = true
    RETURNING *
  `);
  if (rows.length === 0) {
    return null;
  }
  return mapRow(rows[0]!);
}

export async function markManagedEmailDomainApplied(id: string): Promise<ManagedEmailDomain> {
  const rows = await globalPrismaClient.$queryRaw<ManagedEmailDomainRow[]>(Prisma.sql`
    UPDATE "ManagedEmailDomain"
    SET
      "status" = 'APPLIED'::"ManagedEmailDomainStatus",
      "appliedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
    RETURNING *
  `);
  if (rows.length === 0) {
    throw new StackAssertionError("Managed email domain row missing while applying", {
      managedEmailDomainId: id,
    });
  }
  return mapRow(rows[0]!);
}

export async function listManagedEmailDomainsForTenancy(tenancyId: string): Promise<ManagedEmailDomain[]> {
  const rows = await globalPrismaClient.$queryRaw<ManagedEmailDomainRow[]>(Prisma.sql`
    SELECT *
    FROM "ManagedEmailDomain"
    WHERE "tenancyId" = ${tenancyId}
    ORDER BY "isActive" DESC, "updatedAt" DESC
  `);
  return rows.map(mapRow);
}
