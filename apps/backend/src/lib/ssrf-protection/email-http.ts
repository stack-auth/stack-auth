import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import dns from "node:dns/promises";
import net from "node:net";
import { hostnameWithoutIpv6Brackets, isBlockedPrivateOrReservedIpAddress } from "./core";

/**
 * Egress policy for tenant-configured HTTP email providers (Resend, useSend).
 *
 * The SMTP sibling of this module exists because a tenant can point the email server at any host.
 * The same applies here, and more sharply: a self-hosted provider's base URL is a full URL the
 * tenant controls, so without a check it is a request-forgery primitive pointed at whatever the
 * backend can reach. Mirrors checkSmtpEgressPolicy's shape so the caller handles both the same way.
 */

export type HttpEmailEgressPolicyViolation = {
  reason: "invalid-url" | "insecure-scheme" | "internal-ip-literal" | "internal-resolved-address" | "no-dns-addresses" | "dns-lookup-failed",
  baseUrl: string,
  addresses?: string[],
  cause?: unknown,
};

export type HttpEmailEgressPolicyResult =
  | { status: "ok", url: URL }
  | { status: "error", violation: HttpEmailEgressPolicyViolation };

/**
 * Whether to enforce the policy for tenant-provided ("standard") HTTP email configs. Disabled in
 * development and tests, where a provider legitimately runs on localhost.
 *
 * Self-hosting note: a useSend instance reached over a provider's internal network (for example a
 * Railway private domain) resolves to a private address and is therefore rejected by default. That
 * is the intended default — it is indistinguishable from an attacker aiming the backend at an
 * internal service. Operators who deliberately run useSend on the same private network should set
 * HEXCLAVE_ALLOW_STANDARD_EMAIL_PRIVATE_HOSTS=true, or point the config at its public domain.
 */
export function shouldEnforceHttpEmailEgressPolicy(): boolean {
  if (["development", "test"].includes(getNodeEnvironment())) {
    return false;
  }
  return getEnvVariable("HEXCLAVE_ALLOW_STANDARD_EMAIL_PRIVATE_HOSTS", "false") !== "true";
}

export async function checkHttpEmailEgressPolicy(options: { baseUrl: string }): Promise<HttpEmailEgressPolicyResult> {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch (error) {
    return { status: "error", violation: { reason: "invalid-url", baseUrl: options.baseUrl, cause: error } };
  }

  // Plain HTTP would send the provider API key in cleartext, so it is refused even for a host that
  // passes every address check below.
  if (url.protocol !== "https:") {
    return { status: "error", violation: { reason: "insecure-scheme", baseUrl: options.baseUrl } };
  }

  const hostname = hostnameWithoutIpv6Brackets(url.hostname);

  if (net.isIP(hostname) !== 0) {
    if (isBlockedPrivateOrReservedIpAddress(hostname)) {
      return { status: "error", violation: { reason: "internal-ip-literal", baseUrl: options.baseUrl, addresses: [hostname] } };
    }
    return { status: "ok", url };
  }

  let addresses: string[];
  try {
    const lookupResults = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = [...new Set(lookupResults.map((result) => result.address))];
  } catch (error) {
    return { status: "error", violation: { reason: "dns-lookup-failed", baseUrl: options.baseUrl, cause: error } };
  }

  if (addresses.length === 0) {
    return { status: "error", violation: { reason: "no-dns-addresses", baseUrl: options.baseUrl } };
  }

  const internalAddresses = addresses.filter(isBlockedPrivateOrReservedIpAddress);
  if (internalAddresses.length > 0) {
    return { status: "error", violation: { reason: "internal-resolved-address", baseUrl: options.baseUrl, addresses: internalAddresses } };
  }

  // Unlike the SMTP policy, the validated address cannot be pinned for the actual request: fetch()
  // re-resolves the hostname itself, leaving a DNS-rebinding window between this check and the
  // connection. This matches how assertSafeOAuthUrl already guards outbound OAuth requests. The
  // exposure is bounded — the request body is a fixed email payload and the response is discarded
  // apart from its status — but a pinning dispatcher would close it if this ever carries more.
  return { status: "ok", url };
}
