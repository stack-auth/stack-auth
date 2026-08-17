import {
  assertPublicInternetResolvedAddress,
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
} from "./core";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import dns from "node:dns/promises";
import net from "node:net";
import type { ClientConfig } from "pg";

const EXTERNAL_DB_SYNC_SSRF_PROTECTION_ERROR =
  "External Postgres DB sync connection strings must use postgres:// or postgresql:// and resolve only to public internet addresses.";

const EXTERNAL_DB_CONNECT_TIMEOUT_MS = 10_000;

function shouldEnforceExternalDbSyncSsrfProtection(): boolean {
  if (["development", "test"].includes(getNodeEnvironment())) {
    return false;
  }
  return getEnvVariable("HEXCLAVE_ALLOW_EXTERNAL_DB_SYNC_PRIVATE_HOSTS", "false") !== "true";
}

function externalDbSyncSsrfProtectionError() {
  return new StatusError(StatusError.BadRequest, EXTERNAL_DB_SYNC_SSRF_PROTECTION_ERROR);
}

function parseExternalPostgresConnectionString(connectionString: string): URL {
  let url;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw externalDbSyncSsrfProtectionError();
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw externalDbSyncSsrfProtectionError();
  }

  if (!url.hostname) {
    throw externalDbSyncSsrfProtectionError();
  }

  return url;
}

function isLocalhostName(hostname: string): boolean {
  const normalizedHostname = hostnameWithoutIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  return normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost");
}

function buildPinnedPostgresSslConfig(searchParams: URLSearchParams, servername: string): ClientConfig["ssl"] {
  const sslParam = searchParams.get("ssl");
  if (sslParam === "0" || sslParam === "false") {
    return false;
  }
  const sslMode = searchParams.get("sslmode");
  if (sslMode === "disable") {
    return false;
  }
  if (sslMode === "no-verify") {
    // Matches pg's handling of sslmode=no-verify: encrypt but skip certificate verification.
    return { servername, rejectUnauthorized: false };
  }
  if (sslParam != null || sslMode != null) {
    // TLS is enabled (ssl=true / sslmode=prefer|require|verify-ca|verify-full). Because we connect to
    // a pinned IP rather than the hostname, the SNI + certificate-identity name must be set to the
    // original hostname, otherwise verification would run against the IP and fail.
    return { servername };
  }
  // No SSL parameters at all: preserve pg's default (no TLS unless configured via PGSSLMODE).
  return undefined;
}

function buildPinnedPostgresClientOptions(url: URL, pinnedAddress: string, servername: string): ClientConfig {
  const options: ClientConfig = {
    host: pinnedAddress,
    connectionTimeoutMillis: EXTERNAL_DB_CONNECT_TIMEOUT_MS,
    ssl: buildPinnedPostgresSslConfig(url.searchParams, servername),
  };
  if (url.port) {
    options.port = Number.parseInt(url.port, 10);
  }
  if (url.username) {
    options.user = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database) {
    options.database = database;
  }
  return options;
}

/**
 * Validates an external Postgres DB sync connection string and returns the `pg` client options to
 * connect with. When SSRF protection is enforced and the target is a hostname, the connection is
 * pinned to a validated resolved address (with the hostname preserved for TLS SNI/cert verification)
 * so that `pg` cannot re-resolve to a different, internal address between our check and its connect
 * (DNS-rebinding TOCTOU). Throws a `StatusError` if the connection string is malformed or resolves
 * to a private/reserved address.
 */
export async function getSafeExternalPostgresClientOptions(connectionString: string): Promise<ClientConfig> {
  const url = parseExternalPostgresConnectionString(connectionString);
  const baseOptions: ClientConfig = {
    connectionString,
    connectionTimeoutMillis: EXTERNAL_DB_CONNECT_TIMEOUT_MS,
  };

  if (!shouldEnforceExternalDbSyncSsrfProtection()) {
    return baseOptions;
  }

  const hostname = hostnameWithoutIpv6Brackets(url.hostname);
  if (isLocalhostName(hostname) || isBlockedPrivateOrReservedIpAddress(hostname)) {
    throw externalDbSyncSsrfProtectionError();
  }

  // IP literals aren't re-resolved at connect time, so validating the literal above already removes
  // any rebinding window — connect straight from the original connection string.
  if (net.isIP(hostname) !== 0) {
    return baseOptions;
  }

  const resolvedAddresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (resolvedAddresses.length === 0) {
    throw externalDbSyncSsrfProtectionError();
  }
  for (const resolved of resolvedAddresses) {
    assertPublicInternetResolvedAddress(resolved.address, externalDbSyncSsrfProtectionError());
  }

  return buildPinnedPostgresClientOptions(url, resolvedAddresses[0].address, hostname);
}

/**
 * Validates an external Postgres DB sync connection string, throwing a `StatusError` if it is unsafe.
 * Prefer {@link getSafeExternalPostgresClientOptions} when you are about to connect, as it also pins
 * the connection against DNS rebinding.
 */
export async function assertSafeExternalPostgresConnectionString(connectionString: string): Promise<void> {
  await getSafeExternalPostgresClientOptions(connectionString);
}
