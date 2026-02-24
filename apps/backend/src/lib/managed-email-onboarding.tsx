import { overrideEnvironmentConfigOverride } from "@/lib/config";
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
  status?: string,
  records?: ResendDomainRecord[],
};

type ManagedEmailSetupResult = {
  domainId: string,
  nameServerRecords: string[],
};

type ManagedEmailCheckResult =
  | { status: "pending", missingNameServerRecords: string[] }
  | { status: "complete" };

function shouldUseMockManagedEmailOnboarding() {
  const nodeEnvironment = getNodeEnvironment();
  if (nodeEnvironment === "test") {
    return true;
  }

  if (nodeEnvironment === "development") {
    const resendApiKey = getEnvVariable("STACK_RESEND_API_KEY", "");
    if (resendApiKey.startsWith("mock_")) {
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
  return normalizedName.endsWith(`.${normalizedZoneName}`)
    ? normalizedName
    : `${normalizedName}.${normalizedZoneName}`;
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

type CloudflareApiError = {
  code?: number,
  message?: string,
};

type CloudflareApiResponse<T> = {
  success?: boolean,
  errors?: CloudflareApiError[],
  result?: T,
};

type CloudflareZone = {
  id: string,
  name: string,
  name_servers?: string[],
};

type CloudflareDnsRecord = {
  id: string,
  type: string,
  name: string,
  content: string,
  priority?: number,
};

async function parseCloudflareJsonOrThrow<T>(response: Response, errorContext: string): Promise<T> {
  const body = await parseJsonOrThrow<CloudflareApiResponse<T>>(response, errorContext);
  if (!body.success || !body.result) {
    throw new StackAssertionError(errorContext, {
      cloudflareErrors: body.errors,
      cloudflareSuccess: body.success,
    });
  }
  return body.result;
}

function getCloudflareBaseUrl() {
  return getEnvVariable("STACK_CLOUDFLARE_API_BASE_URL", "https://api.cloudflare.com/client/v4");
}

function getCloudflareHeaders() {
  return {
    "Authorization": `Bearer ${getEnvVariable("STACK_CLOUDFLARE_API_TOKEN")}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function listCloudflareZones(subdomain: string): Promise<CloudflareZone[]> {
  const cloudflareBaseUrl = getCloudflareBaseUrl();
  const cloudflareAccountId = getEnvVariable("STACK_CLOUDFLARE_ACCOUNT_ID");
  const response = await fetch(`${cloudflareBaseUrl}/zones?name=${encodeURIComponent(subdomain)}&account.id=${encodeURIComponent(cloudflareAccountId)}&page=1&per_page=50`, {
    method: "GET",
    headers: getCloudflareHeaders(),
  });
  const zones = await parseCloudflareJsonOrThrow<CloudflareZone[]>(
    response,
    "Failed to list Cloudflare zones for managed email onboarding",
  );
  return zones.filter((zone) => normalizeDomainName(zone.name) === normalizeDomainName(subdomain));
}

async function getCloudflareZoneById(zoneId: string): Promise<CloudflareZone> {
  const cloudflareBaseUrl = getCloudflareBaseUrl();
  const response = await fetch(`${cloudflareBaseUrl}/zones/${encodeURIComponent(zoneId)}`, {
    method: "GET",
    headers: getCloudflareHeaders(),
  });
  return await parseCloudflareJsonOrThrow<CloudflareZone>(
    response,
    "Failed to fetch Cloudflare zone details for managed email onboarding",
  );
}

async function createCloudflareZone(subdomain: string): Promise<CloudflareZone> {
  const cloudflareBaseUrl = getCloudflareBaseUrl();
  const cloudflareAccountId = getEnvVariable("STACK_CLOUDFLARE_ACCOUNT_ID");
  const response = await fetch(`${cloudflareBaseUrl}/zones`, {
    method: "POST",
    headers: getCloudflareHeaders(),
    body: JSON.stringify({
      account: {
        id: cloudflareAccountId,
      },
      name: normalizeDomainName(subdomain),
      type: "full",
      jump_start: false,
    }),
  });
  return await parseCloudflareJsonOrThrow<CloudflareZone>(
    response,
    "Failed to create Cloudflare zone for managed email onboarding",
  );
}

async function createOrReuseCloudflareZone(subdomain: string): Promise<CloudflareZone> {
  const existingZones = await listCloudflareZones(subdomain);
  if (existingZones.length > 1) {
    throw new StackAssertionError("Multiple Cloudflare zones found for managed email onboarding subdomain", {
      subdomain,
      zoneIds: existingZones.map((zone) => zone.id),
    });
  }
  const zone = existingZones[0] ?? await createCloudflareZone(subdomain);
  if (zone.name_servers?.length) {
    return zone;
  }
  return await getCloudflareZoneById(zone.id);
}

async function listCloudflareDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]> {
  const cloudflareBaseUrl = getCloudflareBaseUrl();
  const response = await fetch(`${cloudflareBaseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records?page=1&per_page=5000`, {
    method: "GET",
    headers: getCloudflareHeaders(),
  });
  return await parseCloudflareJsonOrThrow<CloudflareDnsRecord[]>(
    response,
    "Failed to list Cloudflare DNS records for managed email onboarding",
  );
}

async function createCloudflareDnsRecord(zoneId: string, record: {
  type: string,
  name: string,
  content: string,
  priority?: number,
}) {
  const cloudflareBaseUrl = getCloudflareBaseUrl();
  const response = await fetch(`${cloudflareBaseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    headers: getCloudflareHeaders(),
    body: JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: 1,
      ...(record.priority == null ? {} : { priority: record.priority }),
    }),
  });
  await parseCloudflareJsonOrThrow<CloudflareDnsRecord>(
    response,
    "Failed to create Cloudflare DNS record for managed email onboarding",
  );
}

type DesiredCloudflareDnsRecord = {
  type: "TXT" | "CNAME" | "MX",
  name: string,
  content: string,
  priority?: number,
};

function resendRecordToDesiredCloudflareRecord(record: ResendDomainRecord, subdomain: string): DesiredCloudflareDnsRecord | null {
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

function recordsEqual(existingRecord: CloudflareDnsRecord, desiredRecord: DesiredCloudflareDnsRecord) {
  const sameName = normalizeDomainName(existingRecord.name) === normalizeDomainName(desiredRecord.name);
  const sameType = existingRecord.type.toUpperCase() === desiredRecord.type;
  const sameContent = normalizeRecordContent(existingRecord.content) === normalizeRecordContent(desiredRecord.content);
  const samePriority = desiredRecord.type !== "MX" || (existingRecord.priority ?? null) === (desiredRecord.priority ?? null);
  return sameName && sameType && sameContent && samePriority;
}

async function upsertCloudflareResendRecords(zoneId: string, subdomain: string, resendRecords: ResendDomainRecord[]) {
  const existingRecords = await listCloudflareDnsRecords(zoneId);
  const desiredRecords = resendRecords
    .map((record) => resendRecordToDesiredCloudflareRecord(record, subdomain))
    .filter((record): record is DesiredCloudflareDnsRecord => record != null);

  for (const desiredRecord of desiredRecords) {
    const recordsWithSameName = existingRecords.filter(
      (existingRecord) => normalizeDomainName(existingRecord.name) === normalizeDomainName(desiredRecord.name),
    );
    const exactMatch = recordsWithSameName.find((existingRecord) => recordsEqual(existingRecord, desiredRecord));
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
      throw new StackAssertionError("Cannot create Cloudflare DNS record because of CNAME conflict", {
        zoneId,
        desiredRecord,
      });
    }

    if (desiredRecord.type === "CNAME" && recordsWithSameName.some((existingRecord) => existingRecord.type.toUpperCase() === "CNAME")) {
      throw new StackAssertionError("Cloudflare CNAME record already exists with different content", {
        zoneId,
        desiredRecord,
        existingRecords: recordsWithSameName,
      });
    }

    await createCloudflareDnsRecord(zoneId, desiredRecord);
    existingRecords.push({
      id: `created-${desiredRecord.type}-${desiredRecord.name}-${desiredRecord.content}`,
      type: desiredRecord.type,
      name: desiredRecord.name,
      content: desiredRecord.content,
      priority: desiredRecord.priority,
    });
  }
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

  const body = await parseJsonOrThrow<{ id: string, name: string, records?: ResendDomainRecord[] }>(
    response,
    "Failed to create Resend domain for managed email onboarding",
  );

  return {
    id: body.id,
    name: body.name,
    records: body.records,
  };
}

async function getResendDomain(domainId: string): Promise<ResendDomain> {
  const resendApiKey = getEnvVariable("STACK_RESEND_API_KEY");
  const response = await fetch(`https://api.resend.com/domains/${encodeURIComponent(domainId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await parseJsonOrThrow<{ id: string, name: string, status?: string, records?: ResendDomainRecord[] }>(
    response,
    "Failed to fetch Resend domain during managed email onboarding check",
  );
  return body;
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
    "Failed to create scoped Resend API key during managed email onboarding check",
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

export async function setupManagedEmailProvider(options: { subdomain: string, senderLocalPart: string, tenancyId: string }): Promise<ManagedEmailSetupResult> {
  assertValidManagedSubdomain(options.subdomain);
  assertValidManagedSenderLocalPart(options.senderLocalPart);

  if (shouldUseMockManagedEmailOnboarding()) {
    return {
      domainId: `managed_mock_${options.tenancyId}_${options.subdomain}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
      nameServerRecords: ["alex.ns.cloudflare.com", "jamie.ns.cloudflare.com"],
    };
  }

  const resendDomain = await createResendDomain(options.subdomain);
  const cloudflareZone = await createOrReuseCloudflareZone(options.subdomain);
  await upsertCloudflareResendRecords(cloudflareZone.id, options.subdomain, resendDomain.records ?? []);

  const zoneNameServers = cloudflareZone.name_servers ?? [];
  if (zoneNameServers.length === 0) {
    throw new StackAssertionError("Cloudflare zone was created without nameservers for managed email onboarding", {
      zoneId: cloudflareZone.id,
      subdomain: options.subdomain,
    });
  }

  return {
    domainId: resendDomain.id,
    nameServerRecords: zoneNameServers,
  };
}

export async function checkManagedEmailProviderStatus(options: {
  tenancy: Tenancy,
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
}): Promise<ManagedEmailCheckResult> {
  assertValidManagedSubdomain(options.subdomain);
  assertValidManagedSenderLocalPart(options.senderLocalPart);

  if (shouldUseMockManagedEmailOnboarding()) {
    const mockApiKey = `managed_mock_key_${options.tenancy.id}`;
    await saveManagedEmailProviderConfig({
      tenancy: options.tenancy,
      resendApiKey: mockApiKey,
      subdomain: options.subdomain,
      senderLocalPart: options.senderLocalPart,
    });
    return { status: "complete" };
  }

  const resendDomain = await getResendDomain(options.domainId);
  const notVerifiedRecords = resendDomain.records
    ?.filter((record) => record.record === "NS" || record.type === "NS")
    .filter((record) => record.status !== "verified")
    .map((record) => record.value)
    .filter((value) => value.length > 0) ?? [];

  if ((resendDomain.status !== "verified" && notVerifiedRecords.length > 0) || notVerifiedRecords.length > 0) {
    return {
      status: "pending",
      missingNameServerRecords: notVerifiedRecords,
    };
  }

  const resendApiKey = await createResendScopedKey({
    subdomain: options.subdomain,
    domainId: options.domainId,
    tenancyId: options.tenancy.id,
  });

  await saveManagedEmailProviderConfig({
    tenancy: options.tenancy,
    resendApiKey,
    subdomain: options.subdomain,
    senderLocalPart: options.senderLocalPart,
  });

  return { status: "complete" };
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
      "emails.server": {
        isShared: false,
        provider: "managed",
        host: undefined,
        port: undefined,
        username: undefined,
        password: options.resendApiKey,
        senderName: options.tenancy.project.display_name,
        senderEmail: getManagedSenderEmail(options.subdomain, options.senderLocalPart),
        managedSubdomain: options.subdomain,
        managedSenderLocalPart: options.senderLocalPart,
      } as Tenancy["config"]["emails"]["server"],
    },
  });
}
