import {
  assertPublicInternetResolvedAddress,
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
} from "@/lib/ssrf-protection/core";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { yupObject, yupString, yupValidate } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import dns from "node:dns/promises";
import net from "node:net";
import type { DataSourceConnection } from "../types";
import { parseJsonPreservingBigIntegers } from "./json";

/**
 * Requests go to a customer-supplied deployment, so they are bounded and
 * identifiable, the same way the Postgres driver's queries are.
 */
const REQUEST_TIMEOUT_MS = 120_000;
const USER_AGENT = "hexclave_data_source_sync";

const convexConfigSchema = yupObject({
  deploymentUrl: yupString().defined(),
}).defined();

export type ConvexCredentials = {
  deploymentUrl: string,
  /** A Convex deploy key with the `deployment:data:view` permission. */
  deployKey: string,
};

/**
 * Reads a stored connection back into the shape this driver works in. Validated
 * rather than cast, because `config` is an opaque JSON column and a row written
 * by an older shape of this driver must fail loudly rather than call a partly
 * undefined URL.
 */
export async function toConvexCredentials(connection: DataSourceConnection): Promise<ConvexCredentials> {
  const config = await yupValidate(convexConfigSchema, connection.config);
  return { deploymentUrl: config.deploymentUrl, deployKey: connection.secret };
}

function ssrfError() {
  return new StatusError(
    StatusError.BadRequest,
    "A Convex deployment URL must use http(s) and resolve only to public internet addresses.",
  );
}

function shouldEnforceSsrfProtection(): boolean {
  // Matches the Postgres source's toggle so an operator configures one thing,
  // and so a local Convex backend is reachable from a dev stack.
  if (["development", "test"].includes(getNodeEnvironment())) return false;
  return getEnvVariable("HEXCLAVE_ALLOW_EXTERNAL_DB_SYNC_PRIVATE_HOSTS", "false") !== "true";
}

/**
 * Normalises what the customer pasted — a Convex dashboard shows the deployment
 * URL with no path, but people paste trailing slashes and occasionally a path —
 * and refuses anything that would let this become an SSRF primitive.
 */
export async function assertSafeDeploymentUrl(deploymentUrl: string): Promise<URL> {
  let url;
  try {
    url = new URL(deploymentUrl);
  } catch {
    throw ssrfError();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw ssrfError();
  if (!url.hostname) throw ssrfError();

  if (!shouldEnforceSsrfProtection()) return url;

  const hostname = hostnameWithoutIpv6Brackets(url.hostname);
  if (isBlockedPrivateOrReservedIpAddress(hostname)) throw ssrfError();
  if (net.isIP(hostname) !== 0) return url;

  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) throw ssrfError();
  for (const address of resolved) {
    assertPublicInternetResolvedAddress(address.address, ssrfError());
  }
  return url;
}

/**
 * One request to a Convex deployment.
 *
 * The response is read as text and parsed by {@link parseJsonPreservingBigIntegers}
 * rather than `response.json()`, because Convex's nanosecond version timestamps
 * do not survive a double.
 */
export async function convexRequest(
  credentials: ConvexCredentials,
  path: string,
  options: { method: "GET" | "POST", body?: unknown },
): Promise<unknown> {
  const base = await assertSafeDeploymentUrl(credentials.deploymentUrl);
  const url = new URL(path, base);

  let response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: {
        // Convex's own scheme for deploy keys; `Bearer` is for end-user tokens
        // and is rejected on these routes.
        authorization: `Convex ${credentials.deployKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StatusError(
      StatusError.BadRequest,
      `Could not reach the Convex deployment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new StatusError(StatusError.BadRequest, describeFailure(response.status, text));
  }
  // Some Convex routes acknowledge success with an empty body rather than
  // `null`, so an empty response is a result, not a parse failure.
  if (text.trim() === "") return null;
  try {
    return parseJsonPreservingBigIntegers(text);
  } catch (error) {
    throw new StatusError(
      StatusError.BadRequest,
      `The Convex deployment returned a response we could not read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Turns Convex's error body into something the customer can act on. The two that
 * matter are a rejected key and the Pro-plan gate on streaming export, and both
 * are fixed in the Convex dashboard rather than here.
 */
function describeFailure(status: number, body: string): string {
  const detail = extractMessage(body);
  if (status === 401 || status === 403) {
    return `Convex rejected the deploy key${detail}. It needs the "deployment:data:view" permission.`;
  }
  if (status === 402) {
    return `Convex refused the change feed${detail}. Streaming export requires a Convex Pro plan.`;
  }
  return `Convex returned ${status}${detail}.`;
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown, code?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : null;
    if (message != null) return `: ${message}`;
  } catch {
    // Not JSON; fall through to the truncated body below.
  }
  const trimmed = body.trim();
  return trimmed === "" ? "" : `: ${trimmed.slice(0, 200)}`;
}
