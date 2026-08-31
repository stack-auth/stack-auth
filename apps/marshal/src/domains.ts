import { badRequest, conflict, notFound } from "./errors.js";
import { ensureDomainGateway } from "./gcp/runtime.js";
import { tenantContext } from "./gcp/context.js";
import { withReconciliationLease } from "./reconciliation-lock.js";
import { withPlatformDomainLease } from "./platform-domain-lock.js";
import { assertServiceCanHoldADomain, resolveEnv } from "./services.js";
import { claimDomain, readDomainClaim, readDomainClaimVersioned, readSpec, releaseDomainClaim, rewriteDomainClaim } from "./store.js";
import type { DnsRecord } from "./types.js";

// KEPT IN SYNC WITH the backend's HOSTNAME_REGEX (apps/backend/src/lib/deployments/index.tsx),
// duplicated because Marshal is standalone and takes no @hexclave/shared dependency.
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
  return await withReconciliationLease(ns, serviceKey, async (lease) => {
    const stored = await readSpec(ns, serviceKey);
    if (stored === null) throw notFound(`service ${JSON.stringify(serviceKey)} not found in namespace ${JSON.stringify(ns)}`);
    assertServiceCanHoldADomain(serviceKey, stored.spec.config.ports, stored.spec.config.public, "Change the service's ports first, then attach the domain.");
    const existingClaim = await readDomainClaimVersioned(hostname);
    if (existingClaim === null) {
      const claimed = await claimDomain({ hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
      if (!claimed) throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
    } else if (existingClaim.value.ns !== ns) {
      throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
    } else if (existingClaim.value.service_key !== serviceKey) {
      const rewritten = await rewriteDomainClaim(existingClaim, { hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
      if (!rewritten) throw conflict(`hostname ${JSON.stringify(hostname)} changed owners concurrently; retry the attach`);
      await lease.assertOwned();
      await withPlatformDomainLease(async (platformLease) => {
        await lease.assertOwned();
        await platformLease.assertOwned();
        await (await tenantContext(ns)).domains.delete(hostname);
      });
    } else {
      await claimDomain(existingClaim.value);
    }

    const resolved = await resolveEnv(ns, stored.spec.env);
    if (!resolved.ok) throw badRequest(`service ${JSON.stringify(serviceKey)} is blocked on unresolved environment references`);
    const target = await ensureDomainGateway(stored, lease);
    await lease.assertOwned();
    const state = await withPlatformDomainLease(async (platformLease) => {
      await lease.assertOwned();
      await platformLease.assertOwned();
      return await (await tenantContext(ns)).domains.ensure(hostname, target);
    });
    return { hostname, service_key: serviceKey, verified: state.verified, dns_records: state.dnsRecords };
  });
}

export async function readDomain(ns: string, hostname: string): Promise<AttachDomainResult> {
  const claim = await readDomainClaim(hostname);
  if (claim === null || claim.ns !== ns) throw notFound(`hostname ${JSON.stringify(hostname)} is not attached in namespace ${JSON.stringify(ns)}`);
  const state = await (await tenantContext(ns)).domains.get(hostname);
  if (state === null) throw notFound(`hostname ${JSON.stringify(hostname)} has no load balancer on service ${JSON.stringify(claim.service_key)}`);
  return { hostname, service_key: claim.service_key, verified: state.verified, dns_records: state.dnsRecords };
}

export async function detachDomain(ns: string, hostname: string, expectedServiceKey?: string): Promise<void> {
  const claim = await readDomainClaimVersioned(hostname);
  if (claim === null || claim.value.ns !== ns) throw notFound(`hostname ${JSON.stringify(hostname)} is not attached in namespace ${JSON.stringify(ns)}`);
  if (expectedServiceKey !== undefined && claim.value.service_key !== expectedServiceKey) {
    throw notFound(`hostname ${JSON.stringify(hostname)} is not attached to service ${JSON.stringify(expectedServiceKey)} in namespace ${JSON.stringify(ns)}`);
  }
  await withReconciliationLease(ns, claim.value.service_key, async (lease) => {
    await withPlatformDomainLease(async (platformLease) => {
      await lease.assertOwned();
      await platformLease.assertOwned();
      await (await tenantContext(ns)).domains.delete(hostname);
    });
    await lease.assertOwned();
    await releaseDomainClaim(claim);
  });
}
