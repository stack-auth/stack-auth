import { hostnameWithoutIpv6Brackets, isBlockedPrivateOrReservedIpAddress } from "./core";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import dns from "node:dns/promises";
import net from "node:net";

export type SmtpEgressPolicyViolation = {
  reason: "disallowed-port" | "internal-ip-literal" | "internal-resolved-address" | "no-dns-addresses" | "dns-lookup-failed",
  host: string,
  port: number,
  addresses?: string[],
  cause?: unknown,
};

export type SmtpEgressPolicyResult =
  | {
    status: "ok",
    addresses: string[],
    // The address the caller must actually connect to. For hostnames this is one of the validated
    // resolved addresses, so the SMTP client can't re-resolve the hostname to a different (internal)
    // address between our check and its connect — closing the DNS-rebinding TOCTOU window.
    connectHost: string,
    // The original hostname to use as the TLS SNI / certificate-identity name when connecting to the
    // pinned IP. `null` when the caller passed an IP literal (no SNI needed).
    servername: string | null,
  }
  | { status: "error", violation: SmtpEgressPolicyViolation };

const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2465, 2587, 2525]);

/**
 * Whether the SMTP egress policy should be enforced for tenant-provided ("standard") email server
 * configs. Disabled in local development and tests, where custom SMTP configs legitimately point at
 * localhost (e.g. Inbucket), and can be disabled by self-host operators who intentionally relay
 * through an SMTP server on a private network.
 */
export function shouldEnforceSmtpEgressPolicy(): boolean {
  if (["development", "test"].includes(getNodeEnvironment())) {
    return false;
  }
  return getEnvVariable("HEXCLAVE_ALLOW_STANDARD_SMTP_PRIVATE_HOSTS", "false") !== "true";
}

async function resolveSmtpHost(host: string): Promise<{ addresses: string[], errors: unknown[] }> {
  try {
    const lookupResults = await dns.lookup(hostnameWithoutIpv6Brackets(host), { all: true, verbatim: true });
    return {
      addresses: [...new Set(lookupResults.map((result) => result.address))],
      errors: [],
    };
  } catch (error) {
    return {
      addresses: [],
      errors: [error],
    };
  }
}

export async function checkSmtpEgressPolicy(options: {
  host: string,
  port: number,
}): Promise<SmtpEgressPolicyResult> {
  if (!ALLOWED_SMTP_PORTS.has(options.port)) {
    return {
      status: "error",
      violation: {
        reason: "disallowed-port",
        host: options.host,
        port: options.port,
      },
    };
  }

  const normalizedHost = hostnameWithoutIpv6Brackets(options.host);
  if (net.isIP(normalizedHost)) {
    if (isBlockedPrivateOrReservedIpAddress(normalizedHost)) {
      return {
        status: "error",
        violation: {
          reason: "internal-ip-literal",
          host: options.host,
          port: options.port,
          addresses: [normalizedHost],
        },
      };
    }
    return { status: "ok", addresses: [normalizedHost], connectHost: normalizedHost, servername: null };
  }

  const resolved = await resolveSmtpHost(options.host);
  if (resolved.addresses.length === 0) {
    return {
      status: "error",
      violation: {
        reason: resolved.errors.length > 0 ? "dns-lookup-failed" : "no-dns-addresses",
        host: options.host,
        port: options.port,
        cause: resolved.errors,
      },
    };
  }

  const internalAddresses = resolved.addresses.filter(isBlockedPrivateOrReservedIpAddress);
  if (internalAddresses.length > 0) {
    return {
      status: "error",
      violation: {
        reason: "internal-resolved-address",
        host: options.host,
        port: options.port,
        addresses: internalAddresses,
      },
    };
  }

  return {
    status: "ok",
    addresses: resolved.addresses,
    connectHost: resolved.addresses[0],
    servername: normalizedHost,
  };
}
