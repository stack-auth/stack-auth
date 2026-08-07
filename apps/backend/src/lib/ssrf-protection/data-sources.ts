import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  assertHostnameResolvesToPublicInternet,
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
} from "./core";
import net from "node:net";

/**
 * Egress guard for the Data Sources connector runtime.
 *
 * Every URL the runtime fetches is at least partly attacker-influenced: the
 * connector manifest supplies the shape, but the customer supplies config
 * values that are interpolated into it (`{config.subdomain}`), and — for
 * `next_url` paginators — the REMOTE SERVER supplies the next URL outright.
 * That last case is why this check runs per request rather than once at setup:
 * a compliant first response can hand back `http://169.254.169.254/…` as its
 * next page.
 */
const DATA_SOURCE_SSRF_PROTECTION_ERROR =
  "Data source URLs must use HTTPS and resolve only to public internet addresses.";

function shouldEnforceDataSourceSsrfProtection(): boolean {
  // Mirrors the OAuth guard: local development talks to fixture servers on
  // localhost, which the production policy correctly forbids.
  return !["development", "test"].includes(getNodeEnvironment());
}

export function assertSafeDataSourceUrlWithoutDns(urlString: string): URL {
  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new StatusError(StatusError.BadRequest, "Data source URL is not a valid URL.");
  }

  if (!shouldEnforceDataSourceSsrfProtection()) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new StatusError(StatusError.BadRequest, DATA_SOURCE_SSRF_PROTECTION_ERROR);
    }
    return url;
  }

  if (url.protocol !== "https:") {
    throw new StatusError(StatusError.BadRequest, DATA_SOURCE_SSRF_PROTECTION_ERROR);
  }

  if (isBlockedPrivateOrReservedIpAddress(url.hostname)) {
    throw new StatusError(StatusError.BadRequest, DATA_SOURCE_SSRF_PROTECTION_ERROR);
  }

  return url;
}

export async function assertSafeDataSourceUrl(urlString: string): Promise<URL> {
  const url = assertSafeDataSourceUrlWithoutDns(urlString);
  if (!shouldEnforceDataSourceSsrfProtection()) {
    return url;
  }

  const hostname = hostnameWithoutIpv6Brackets(url.hostname);
  if (net.isIP(hostname) !== 0) {
    return url;
  }

  await assertHostnameResolvesToPublicInternet(
    hostname,
    new StatusError(StatusError.BadRequest, DATA_SOURCE_SSRF_PROTECTION_ERROR),
  );
  return url;
}

import.meta.vitest?.test("rejects non-URLs regardless of environment", ({ expect }) => {
  expect(() => assertSafeDataSourceUrlWithoutDns("not a url")).toThrow("not a valid URL");
});
