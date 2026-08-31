import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  DnsLookupCallback,
  assertHostnameResolvesToPublicInternet,
  assertPublicInternetResolvedAddress,
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
  publicInternetDnsLookup,
} from "./core";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

const OAUTH_SSRF_PROTECTION_ERROR = "OAuth provider URLs must use HTTPS and resolve only to public internet addresses.";

function shouldEnforceOAuthSsrfProtection(): boolean {
  return !["development", "test"].includes(getNodeEnvironment());
}

export function isBlockedOAuthIpAddress(address: string): boolean {
  return isBlockedPrivateOrReservedIpAddress(address);
}

export function assertSafeOAuthUrlWithoutDns(urlString: string): URL {
  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new StatusError(StatusError.BadRequest, "OAuth provider URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR);
  }

  if (isBlockedOAuthIpAddress(url.hostname)) {
    throw new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR);
  }

  return url;
}

export async function assertSafeOAuthUrl(urlString: string): Promise<void> {
  if (!shouldEnforceOAuthSsrfProtection()) {
    return;
  }

  const url = assertSafeOAuthUrlWithoutDns(urlString);
  const hostname = hostnameWithoutIpv6Brackets(url.hostname);
  if (net.isIP(hostname) !== 0) {
    return;
  }

  await assertHostnameResolvesToPublicInternet(hostname, new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR));
}

export function assertSafeOAuthResolvedAddress(address: string): void {
  assertPublicInternetResolvedAddress(address, new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR));
}

export function safeOAuthDnsLookup(hostname: string, options: dns.LookupOptions, callback: DnsLookupCallback): void {
  if (!shouldEnforceOAuthSsrfProtection()) {
    dns.lookup(hostname, options, callback);
    return;
  }

  publicInternetDnsLookup(
    hostname,
    options,
    callback,
    new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR),
  );
}

const OAUTH_DOCUMENT_MAX_BYTES = 1_048_576;

/**
 * Fetches an OAuth metadata document with DNS protection on the actual TLS connection.
 *
 * This uses `node:https` instead of global `fetch` because the request must receive
 * `safeOAuthDnsLookup`; guarding the lookup used by the connection prevents DNS rebinding
 * between an initial URL check and the address actually contacted. The timeout and response-size
 * cap keep unauthenticated metadata resolution bounded.
 */
export async function fetchOAuthJsonDocument(url: URL): Promise<unknown> {
  if (url.protocol !== "https:") {
    throw new Error("OAuth metadata requests must use HTTPS.");
  }

  return await new Promise<unknown>((resolve, reject) => {
    const request = https.request(url, {
      headers: { accept: "application/json" },
      lookup: safeOAuthDnsLookup,
      timeout: 5_000,
    }, response => {
      if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`OAuth metadata request returned status ${response.statusCode ?? "unknown"}.`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > OAUTH_DOCUMENT_MAX_BYTES) {
          request.destroy(new Error("OAuth metadata document exceeds the size limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("OAuth metadata request timed out.")));
    request.on("error", reject);
    request.end();
  });
}
