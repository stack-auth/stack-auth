import { getConfig, resolveNamespaceOrg } from "./config.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { FlyApiError, flyClientForNamespaceOrg } from "./fly/client.js";
import { appNameForService } from "./naming.js";
import { dnsRecordsForCertificate } from "./services.js";
import { claimDomain, readDomainClaim, readSpec, releaseDomainClaim, rewriteDomainClaim } from "./store.js";
import type { DnsRecord } from "./types.js";

// Fly does NOT enforce hostname uniqueness across apps (smoke-verified), so the bucket
// domain registry is the arbiter: a hostname belongs to exactly one (ns, service) claim,
// established with an atomic conditional PUT. Fly certs remain the source of truth for
// verification state; the registry only answers "who owns this hostname".

const HOSTNAME_REGEX = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeHostnameOrThrow(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_REGEX.test(normalized)) throw badRequest(`invalid hostname ${JSON.stringify(hostname)}`);
  return normalized;
}

export type AttachDomainResult = {
  hostname: string,
  service_key: string,
  verified: boolean,
  dns_records: DnsRecord[],
};

export async function attachDomain(ns: string, hostname: string, serviceKey: string): Promise<AttachDomainResult> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const appName = appNameForService(config.envId, ns, serviceKey);
  if (await readSpec(ns, serviceKey) === null) {
    throw notFound(`service ${JSON.stringify(serviceKey)} not found in namespace ${JSON.stringify(ns)}`);
  }

  const existingClaim = await readDomainClaim(hostname);
  if (existingClaim === null) {
    const claimed = await claimDomain({ hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
    if (!claimed) throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
  } else if (existingClaim.ns !== ns) {
    // Never reveal which namespace holds it.
    throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
  } else if (existingClaim.service_key !== serviceKey) {
    // Re-PUT within the namespace repoints: certificate moves from the old service's app.
    const previousApp = appNameForService(config.envId, ns, existingClaim.service_key);
    await fly.deleteCertificate(previousApp, hostname);
    await releasePublicIpsIfUnused(ns, existingClaim.service_key);
    await rewriteDomainClaim(existingClaim, { hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
  } else {
    // Idempotent re-attach on the same service: re-assert the index entry, which repairs the
    // case where a prior claim landed but its index write was lost (an orphaned claim that
    // deleteService could otherwise never release).
    await claimDomain(existingClaim);
  }

  // Public exposure exists only while domains are attached: allocate the shared IPv4 +
  // dedicated IPv6 on first attach (no public IP = private service). Concurrent attaches of
  // different hostnames on the same app can both observe no IP and both allocate a second
  // dedicated v6 — a minor over-allocation the last-detach release reclaims; a true fix needs
  // per-app allocation serialization, tracked for later.
  const ips = await fly.getAppIps(appName);
  if (ips.sharedIpv4 === null) await fly.allocateIp(appName, "shared_v4");
  if (!ips.dedicated.some((ip) => ip.type === "v6")) await fly.allocateIp(appName, "v6");

  let certificate;
  try {
    certificate = await fly.addCertificate(appName, hostname);
  } catch (error) {
    // Same-app re-adds error with "already exists on app" — idempotent re-PUT, read it back.
    if (error instanceof FlyApiError && /already exists/i.test(error.flyMessage)) {
      certificate = await fly.getCertificate(appName, hostname);
      if (certificate === null) throw error;
    } else {
      throw error;
    }
  }

  const refreshedIps = await fly.getAppIps(appName);
  return {
    hostname,
    service_key: serviceKey,
    verified: certificate.clientStatus === "Ready",
    dns_records: dnsRecordsForCertificate(
      appName,
      certificate,
      refreshedIps.sharedIpv4,
      refreshedIps.dedicated.filter((ip) => ip.type === "v6").map((ip) => ip.address),
    ),
  };
}

export async function detachDomain(ns: string, hostname: string): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const claim = await readDomainClaim(hostname);
  if (claim === null || claim.ns !== ns) {
    throw notFound(`hostname ${JSON.stringify(hostname)} is not attached in namespace ${JSON.stringify(ns)}`);
  }
  const appName = appNameForService(config.envId, ns, claim.service_key);
  await fly.deleteCertificate(appName, hostname);
  // Release public IPs BEFORE the claim: a crash between the two must not leave a billable
  // dedicated IP allocated with no claim (and no code path that would ever revisit it). The
  // service stays running and internally reachable; only its public exposure goes away when
  // the last domain detaches.
  await releasePublicIpsIfUnused(ns, claim.service_key);
  await releaseDomainClaim(claim);
}

async function releasePublicIpsIfUnused(ns: string, serviceKey: string): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const appName = appNameForService(config.envId, ns, serviceKey);
  const remaining = await fly.listCertificates(appName);
  if (remaining.length > 0) return;
  const ips = await fly.getAppIps(appName);
  if (ips.sharedIpv4 !== null) await fly.releaseIpByAddress(appName, ips.sharedIpv4);
  for (const ip of ips.dedicated) {
    if (ip.type === "v6") await fly.releaseIpById(appName, ip.id);
  }
}
