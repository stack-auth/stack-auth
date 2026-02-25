import { overrideEnvironmentConfigOverride } from "@/lib/config";
import {
  ManagedEmailDomain,
  ManagedEmailDomainStatus,
  createManagedEmailDomain,
  getManagedEmailDomainByResendDomainId,
  getManagedEmailDomainByTenancyAndSubdomain,
  listManagedEmailDomainsForTenancy,
  markManagedEmailDomainApplied,
  updateManagedEmailDomainWebhookStatus,
} from "@/lib/managed-email-domains";
import { Tenancy } from "@/lib/tenancies";
import { getNodeEnvironment, getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

type ResendDomainRecord = {
  record: string,
  name: string,
  type: string,
  value: string,
  status: string,
  priority?: number,
};

type ResendDomain = {
  id: string,
  name: string,
  status?: "not_started" | "pending" | "verified" | "partially_verified" | "partially_failed" | "failed" | "temporary_failure",
  records?: ResendDomainRecord[],
};

export type ManagedEmailSetupResult = {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  nameServerRecords: string[],
  status: ManagedEmailDomainStatus,
};

export type ManagedEmailCheckResult = {
  status: ManagedEmailDomainStatus,
};

export type ManagedEmailApplyResult = {
  status: "applied",
};

export type ManagedEmailListItem = {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  status: ManagedEmailDomainStatus,
  nameServerRecords: string[],
  verifiedAt: number | null,
  appliedAt: number | null,
};

function shouldUseMockManagedEmailOnboarding() {
  const nodeEnvironment = getNodeEnvironment();
  if (nodeEnvironment === "development") {
    const resendApiKey = getEnvVariable("STACK_RESEND_API_KEY", "");
    const dnsimpleApiToken = getEnvVariable("STACK_DNSIMPLE_API_TOKEN", "");
    const dnsimpleAccountId = getEnvVariable("STACK_DNSIMPLE_ACCOUNT_ID", "");
    if (resendApiKey.startsWith("mock_") || dnsimpleApiToken.length === 0 || dnsimpleAccountId.length === 0) {
      return true;
    }
  }

  return false;
}

function assertValidManagedSubdomain(subdomain: string) {
  if (!/^[a-zA-Z0-9.-]+$/.test(subdomain) || !subdomain.includes(".")) {
    throw new StatusError(400, "subdomain must be a fully-qualified domain name like mail.example.com");
  }
}

function assertValidManagedSenderLocalPart(senderLocalPart: string) {
  if (!/^[a-zA-Z0-9._%+-]+$/.test(senderLocalPart)) {
    throw new StatusError(400, "sender_local_part is invalid");
  }
}

function getManagedSenderEmail(subdomain: string, senderLocalPart: string) {
  return `${senderLocalPart}@${subdomain}`;
}

function normalizeDomainName(name: string) {
  return name.trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeRecordName(name: string, zoneName: string) {
  const normalizedName = normalizeDomainName(name);
  const normalizedZoneName = normalizeDomainName(zoneName);
  if (normalizedName === "@") {
    return normalizedZoneName;
  }
  if (normalizedName === normalizedZoneName) {
    return normalizedZoneName;
  }
  if (normalizedName.endsWith(`.${normalizedZoneName}`)) {
    return normalizedName;
  }

  const zoneLabels = normalizedZoneName.split(".");
  const zoneSubdomainLabel = zoneLabels[0];
  if (zoneSubdomainLabel && normalizedName.endsWith(`.${zoneSubdomainLabel}`)) {
    const recordWithoutZoneSubdomainLabel = normalizedName.slice(0, -(zoneSubdomainLabel.length + 1));
    if (recordWithoutZoneSubdomainLabel.length > 0) {
      return `${recordWithoutZoneSubdomainLabel}.${normalizedZoneName}`;
    }
  }

  return `${normalizedName}.${normalizedZoneName}`;
}

function normalizeRecordContent(content: string) {
  return content.trim().replace(/\.+$/, "");
}

async function parseJsonOrThrow<T>(response: Response, errorContext: string): Promise<T> {
  if (!response.ok) {
    const responseBody = await response.text();
    throw new StackAssertionError(errorContext, {
      status: response.status,
      responseBody,
    });
  }
  return await response.json() as T;
}

type DnsimpleResponse<T> = {
  data?: T,
};

type DnsimpleZone = {
  id: string | number,
  name: string,
};

type DnsimpleDomain = {
  id: string | number,
  name: string,
};

type DnsimpleDnsRecord = {
  id: string | number,
  type: string,
  name: string,
  content: string,
  priority?: number | null,
  prio?: number | null,
};

async function parseDnsimpleJsonOrThrow<T>(response: Response, errorContext: string): Promise<T> {
  const body = await parseJsonOrThrow<DnsimpleResponse<T>>(response, errorContext);
  if (!body.data) {
    throw new StackAssertionError(errorContext, {
      dnsimpleResponseBody: body,
    });
  }
  return body.data;
}

function getDnsimpleBaseUrl() {
  return getEnvVariable("STACK_DNSIMPLE_API_BASE_URL", "https://api.dnsimple.com/v2");
}

function getDnsimpleHeaders() {
  return {
    "Authorization": `Bearer ${getEnvVariable("STACK_DNSIMPLE_API_TOKEN")}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function getDnsimpleAccountId() {
  return getEnvVariable("STACK_DNSIMPLE_ACCOUNT_ID");
}

async function listDnsimpleZones(subdomain: string): Promise<DnsimpleZone[]> {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/zones?name_like=${encodeURIComponent(subdomain)}&page=1&per_page=100`, {
    method: "GET",
    headers: getDnsimpleHeaders(),
  });
  const zones = await parseDnsimpleJsonOrThrow<DnsimpleZone[]>(
    response,
    "Failed to list DNSimple zones for managed email onboarding",
  );
  return zones.filter((zone) => normalizeDomainName(zone.name) === normalizeDomainName(subdomain));
}

async function getDnsimpleZoneByName(zoneName: string): Promise<DnsimpleZone> {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/zones/${encodeURIComponent(zoneName)}`, {
    method: "GET",
    headers: getDnsimpleHeaders(),
  });
  return await parseDnsimpleJsonOrThrow<DnsimpleZone>(
    response,
    "Failed to fetch DNSimple zone details for managed email onboarding",
  );
}

async function createDnsimpleZone(subdomain: string): Promise<DnsimpleZone> {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/domains`, {
    method: "POST",
    headers: getDnsimpleHeaders(),
    body: JSON.stringify({
      name: normalizeDomainName(subdomain),
    }),
  });
  const domain = await parseDnsimpleJsonOrThrow<DnsimpleDomain>(
    response,
    "Failed to create DNSimple domain for managed email onboarding",
  );
  return {
    id: domain.id,
    name: domain.name,
  };
}

async function createOrReuseDnsimpleZone(subdomain: string): Promise<DnsimpleZone> {
  const existingZones = await listDnsimpleZones(subdomain);
  if (existingZones.length > 1) {
    throw new StackAssertionError("Multiple DNSimple zones found for managed email onboarding subdomain", {
      subdomain,
      zoneIds: existingZones.map((zone) => `${zone.id}`),
    });
  }
  const zone = existingZones[0] ?? await createDnsimpleZone(subdomain);
  return await getDnsimpleZoneByName(zone.name);
}

async function getDnsimpleZoneNameServers(zoneName: string): Promise<string[]> {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/zones/${encodeURIComponent(zoneName)}/file`, {
    method: "GET",
    headers: getDnsimpleHeaders(),
  });
  const zoneFile = await parseDnsimpleJsonOrThrow<{ zone?: string }>(
    response,
    "Failed to fetch DNSimple zone file for managed email onboarding",
  );
  const rawZoneFile = zoneFile.zone;
  if (!rawZoneFile) {
    throw new StackAssertionError("DNSimple zone file response did not include zone contents", {
      zoneName,
      zoneFile,
    });
  }

  const nameServerSet = new Set<string>();
  for (const line of rawZoneFile.split("\n")) {
    const match = line.match(/\sIN\s+NS\s+([^\s]+)\s*$/i);
    if (!match) {
      continue;
    }
    const nameServer = normalizeRecordContent(match[1]);
    if (nameServer.length > 0) {
      nameServerSet.add(nameServer);
    }
  }
  return [...nameServerSet];
}

async function listDnsimpleDnsRecords(zoneName: string): Promise<DnsimpleDnsRecord[]> {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/zones/${encodeURIComponent(zoneName)}/records?page=1&per_page=100`, {
    method: "GET",
    headers: getDnsimpleHeaders(),
  });
  return await parseDnsimpleJsonOrThrow<DnsimpleDnsRecord[]>(
    response,
    "Failed to list DNSimple DNS records for managed email onboarding",
  );
}

function toDnsimpleRecordName(recordName: string, zoneName: string) {
  const normalizedRecordName = normalizeDomainName(recordName);
  const normalizedZoneName = normalizeDomainName(zoneName);
  if (normalizedRecordName === normalizedZoneName) {
    return "";
  }
  if (normalizedRecordName.endsWith(`.${normalizedZoneName}`)) {
    return normalizedRecordName.slice(0, -(normalizedZoneName.length + 1));
  }
  throw new StackAssertionError("DNS record name is not inside zone", {
    recordName,
    zoneName,
  });
}

async function createDnsimpleDnsRecord(zoneName: string, record: {
  type: string,
  name: string,
  content: string,
  priority?: number,
}) {
  const dnsimpleBaseUrl = getDnsimpleBaseUrl();
  const dnsimpleAccountId = getDnsimpleAccountId();
  const response = await fetch(`${dnsimpleBaseUrl}/${encodeURIComponent(dnsimpleAccountId)}/zones/${encodeURIComponent(zoneName)}/records`, {
    method: "POST",
    headers: getDnsimpleHeaders(),
    body: JSON.stringify({
      type: record.type,
      name: toDnsimpleRecordName(record.name, zoneName),
      content: record.content,
      ttl: 3600,
      ...(record.priority == null ? {} : { prio: record.priority }),
    }),
  });
  await parseDnsimpleJsonOrThrow<DnsimpleDnsRecord>(
    response,
    "Failed to create DNSimple DNS record for managed email onboarding",
  );
}

type DesiredDnsRecord = {
  type: "TXT" | "CNAME" | "MX",
  name: string,
  content: string,
  priority?: number,
};

function getManagedDmarcDesiredRecord(subdomain: string): DesiredDnsRecord {
  return {
    type: "TXT",
    name: `_dmarc.${normalizeDomainName(subdomain)}`,
    content: "v=DMARC1; p=none",
  };
}

function resendRecordToDesiredDnsRecord(record: ResendDomainRecord, subdomain: string): DesiredDnsRecord | null {
  const recordType = record.type.toUpperCase();
  if (recordType !== "TXT" && recordType !== "CNAME" && recordType !== "MX") {
    return null;
  }

  const normalizedName = normalizeRecordName(record.name, subdomain);
  const normalizedContent = normalizeRecordContent(record.value);
  if (!normalizedContent) {
    return null;
  }
  return {
    type: recordType,
    name: normalizedName,
    content: normalizedContent,
    ...(recordType === "MX" && record.priority != null ? { priority: record.priority } : {}),
  };
}

function recordsEqual(existingRecord: DnsimpleDnsRecord, desiredRecord: DesiredDnsRecord, zoneName: string) {
  const sameName = normalizeRecordName(existingRecord.name, zoneName) === normalizeDomainName(desiredRecord.name);
  const sameType = existingRecord.type.toUpperCase() === desiredRecord.type;
  const sameContent = normalizeRecordContent(existingRecord.content) === normalizeRecordContent(desiredRecord.content);
  const existingPriority = existingRecord.priority ?? existingRecord.prio ?? null;
  const samePriority = desiredRecord.type !== "MX" || existingPriority === (desiredRecord.priority ?? null);
  return sameName && sameType && sameContent && samePriority;
}

async function upsertDnsimpleResendRecords(zoneName: string, subdomain: string, resendRecords: ResendDomainRecord[]) {
  const existingRecords = await listDnsimpleDnsRecords(zoneName);
  const desiredRecords = resendRecords
    .map((record) => resendRecordToDesiredDnsRecord(record, subdomain))
    .filter((record): record is DesiredDnsRecord => record != null);
  desiredRecords.push(getManagedDmarcDesiredRecord(subdomain));

  for (const desiredRecord of desiredRecords) {
    const recordsWithSameName = existingRecords.filter(
      (existingRecord) => normalizeRecordName(existingRecord.name, zoneName) === normalizeDomainName(desiredRecord.name),
    );
    const exactMatch = recordsWithSameName.find((existingRecord) => recordsEqual(existingRecord, desiredRecord, zoneName));
    if (exactMatch != null) {
      continue;
    }

    const hasCnameConflict = recordsWithSameName.some((existingRecord) => {
      const existingType = existingRecord.type.toUpperCase();
      if (desiredRecord.type === "CNAME") {
        return existingType !== "CNAME";
      }
      return existingType === "CNAME";
    });
    if (hasCnameConflict) {
      throw new StackAssertionError("Cannot create DNSimple DNS record because of CNAME conflict", {
        zoneName,
        desiredRecord,
      });
    }

    if (desiredRecord.type === "CNAME" && recordsWithSameName.some((existingRecord) => existingRecord.type.toUpperCase() === "CNAME")) {
      throw new StackAssertionError("DNSimple CNAME record already exists with different content", {
        zoneName,
        desiredRecord,
        existingRecords: recordsWithSameName,
      });
    }

    await createDnsimpleDnsRecord(zoneName, desiredRecord);
    existingRecords.push({
      id: `created-${desiredRecord.type}-${desiredRecord.name}-${desiredRecord.content}`,
      type: desiredRecord.type,
      name: desiredRecord.name,
      content: desiredRecord.content,
      priority: desiredRecord.priority,
    });
  }
}

function isResendDomainAlreadyExistsResponse(responseBody: string) {
  const lower = responseBody.toLowerCase();
  return lower.includes("already exists") || lower.includes("domain exists");
}

async function createResendDomain(subdomain: string): Promise<ResendDomain> {
  const resendApiKey = getEnvVariable("STACK_RESEND_API_KEY");
  const response = await fetch("https://api.resend.com/domains", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: subdomain,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    if ((response.status === 403 || response.status === 409) && isResendDomainAlreadyExistsResponse(responseBody)) {
      throw new StatusError(409, "This subdomain already exists in Resend. If this is from another project, choose a different subdomain.");
    }
    throw new StackAssertionError("Failed to create Resend domain for managed email onboarding", {
      status: response.status,
      responseBody,
    });
  }

  const body = await response.json() as { id: string, name: string, records?: ResendDomainRecord[], status?: ResendDomain["status"] };

  const verifyResponse = await fetch(`https://api.resend.com/domains/${body.id}/verify`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!verifyResponse.ok) {
    const verifyResponseBody = await verifyResponse.text();
    throw new StackAssertionError("Failed to trigger Resend domain verification for managed email onboarding", {
      status: verifyResponse.status,
      responseBody: verifyResponseBody,
      domainId: body.id,
    });
  }

  return {
    id: body.id,
    name: body.name,
    status: body.status,
    records: body.records,
  };
}

async function createResendScopedKey(options: { subdomain: string, domainId: string, tenancyId: string }): Promise<string> {
  const resendApiKey = getEnvVariable("STACK_RESEND_API_KEY");
  const response = await fetch("https://api.resend.com/api-keys", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `stack-managed-${options.tenancyId}-${options.subdomain}`,
      permission: "sending_access",
      domain_id: options.domainId,
    }),
  });
  const body = await parseJsonOrThrow<{ token?: string }>(
    response,
    "Failed to create scoped Resend API key while applying managed email domain",
  );
  if (!body.token) {
    throw new StackAssertionError("Resend did not return an API key token for managed onboarding", {
      domainId: options.domainId,
      tenancyId: options.tenancyId,
      subdomain: options.subdomain,
    });
  }
  return body.token;
}

function managedDomainToSetupResult(domain: ManagedEmailDomain): ManagedEmailSetupResult {
  return {
    domainId: domain.resendDomainId,
    subdomain: domain.subdomain,
    senderLocalPart: domain.senderLocalPart,
    nameServerRecords: domain.nameServerRecords,
    status: domain.status,
  };
}

function managedDomainToListItem(domain: ManagedEmailDomain): ManagedEmailListItem {
  return {
    domainId: domain.resendDomainId,
    subdomain: domain.subdomain,
    senderLocalPart: domain.senderLocalPart,
    status: domain.status,
    nameServerRecords: domain.nameServerRecords,
    verifiedAt: domain.verifiedAt?.getTime() ?? null,
    appliedAt: domain.appliedAt?.getTime() ?? null,
  };
}

export async function setupManagedEmailProvider(options: { subdomain: string, senderLocalPart: string, tenancy: Tenancy }): Promise<ManagedEmailSetupResult> {
  const normalizedSubdomain = normalizeDomainName(options.subdomain);
  assertValidManagedSubdomain(normalizedSubdomain);
  assertValidManagedSenderLocalPart(options.senderLocalPart);

  const existing = await getManagedEmailDomainByTenancyAndSubdomain({
    tenancyId: options.tenancy.id,
    subdomain: normalizedSubdomain,
  });
  if (existing) {
    if (existing.senderLocalPart !== options.senderLocalPart) {
      throw new StatusError(409, "This subdomain is already tracked with a different sender local part");
    }
    return managedDomainToSetupResult(existing);
  }

  if (shouldUseMockManagedEmailOnboarding()) {
    const row = await createManagedEmailDomain({
      tenancyId: options.tenancy.id,
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      subdomain: normalizedSubdomain,
      senderLocalPart: options.senderLocalPart,
      resendDomainId: `managed_mock_${options.tenancy.id}_${normalizedSubdomain}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
      nameServerRecords: ["ns1.dnsimple.com", "ns2.dnsimple.com"],
      status: "verified",
    });
    return managedDomainToSetupResult(row);
  }

  const resendDomain = await createResendDomain(normalizedSubdomain);
  const dnsimpleZone = await createOrReuseDnsimpleZone(normalizedSubdomain);
  await upsertDnsimpleResendRecords(dnsimpleZone.name, normalizedSubdomain, resendDomain.records ?? []);

  const zoneNameServers = await getDnsimpleZoneNameServers(dnsimpleZone.name);
  if (zoneNameServers.length === 0) {
    throw new StackAssertionError("DNSimple zone was created without nameservers for managed email onboarding", {
      zoneId: dnsimpleZone.id,
      subdomain: normalizedSubdomain,
    });
  }

  const row = await createManagedEmailDomain({
    tenancyId: options.tenancy.id,
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    subdomain: normalizedSubdomain,
    senderLocalPart: options.senderLocalPart,
    resendDomainId: resendDomain.id,
    nameServerRecords: zoneNameServers,
    status: resendDomain.status === "verified" ? "verified" : "pending_verification",
  });
  return managedDomainToSetupResult(row);
}

export async function checkManagedEmailProviderStatus(options: {
  tenancy: Tenancy,
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
}): Promise<ManagedEmailCheckResult> {
  const normalizedSubdomain = normalizeDomainName(options.subdomain);
  assertValidManagedSubdomain(normalizedSubdomain);
  assertValidManagedSenderLocalPart(options.senderLocalPart);

  const row = await getManagedEmailDomainByTenancyAndSubdomain({
    tenancyId: options.tenancy.id,
    subdomain: normalizedSubdomain,
  });
  if (!row || row.resendDomainId !== options.domainId || row.senderLocalPart !== options.senderLocalPart) {
    throw new StatusError(404, "Managed domain setup not found for this project/branch");
  }

  return {
    status: row.status,
  };
}

export async function listManagedEmailProviderDomains(options: { tenancy: Tenancy }): Promise<ManagedEmailListItem[]> {
  const rows = await listManagedEmailDomainsForTenancy(options.tenancy.id);
  return rows.map(managedDomainToListItem);
}

export async function applyManagedEmailProvider(options: {
  tenancy: Tenancy,
  domainId: string,
}): Promise<ManagedEmailApplyResult> {
  const domain = await getManagedEmailDomainByResendDomainId(options.domainId);
  if (!domain || domain.tenancyId !== options.tenancy.id || !domain.isActive) {
    throw new StatusError(404, "Managed domain not found for this project/branch");
  }
  if (domain.status === "applied") {
    return { status: "applied" };
  }
  if (domain.status !== "verified") {
    throw new StatusError(409, "Managed domain is not verified yet");
  }

  const resendApiKey = shouldUseMockManagedEmailOnboarding()
    ? `managed_mock_key_${options.tenancy.id}`
    : await createResendScopedKey({
      subdomain: domain.subdomain,
      domainId: domain.resendDomainId,
      tenancyId: options.tenancy.id,
    });

  await saveManagedEmailProviderConfig({
    tenancy: options.tenancy,
    resendApiKey,
    subdomain: domain.subdomain,
    senderLocalPart: domain.senderLocalPart,
  });

  await markManagedEmailDomainApplied(domain.id);
  return { status: "applied" };
}

export async function processResendDomainWebhookEvent(options: {
  domainId: string,
  providerStatusRaw: string,
  errorMessage?: string,
}) {
  const statusLower = options.providerStatusRaw.toLowerCase();
  const mappedStatus: ManagedEmailDomainStatus =
    statusLower === "verified"
      ? "verified"
      : statusLower === "failed" || statusLower === "partially_failed" || statusLower === "temporary_failure"
        ? "failed"
        : "pending_verification";

  await updateManagedEmailDomainWebhookStatus({
    resendDomainId: options.domainId,
    providerStatusRaw: options.providerStatusRaw,
    status: mappedStatus,
    lastError: mappedStatus === "failed" ? (options.errorMessage ?? options.providerStatusRaw) : null,
  });
}

async function saveManagedEmailProviderConfig(options: {
  tenancy: Tenancy,
  resendApiKey: string,
  subdomain: string,
  senderLocalPart: string,
}) {
  await overrideEnvironmentConfigOverride({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    environmentConfigOverrideOverride: {
      "emails.server.isShared": false,
      "emails.server.provider": "managed",
      "emails.server.password": options.resendApiKey,
      "emails.server.senderName": options.tenancy.project.display_name,
      "emails.server.senderEmail": getManagedSenderEmail(options.subdomain, options.senderLocalPart),
      "emails.server.managedSubdomain": options.subdomain,
      "emails.server.managedSenderLocalPart": options.senderLocalPart,
    },
  });
}
