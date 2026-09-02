import {
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
  publicInternetDnsLookup,
  type DnsLookupCallback,
} from "@/lib/ssrf-protection/core";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { yupObject, yupString, yupValidate } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { DataSourceConnection } from "../types";
import { parseJsonPreservingBigIntegers } from "./json";

/**
 * Requests go to a customer-supplied deployment, so they are bounded and
 * identifiable, the same way the Postgres driver's queries are.
 *
 * The timeout is deliberately well under the sync lease: a driver that could
 * spend longer than the lease on a handful of requests would let a second worker
 * claim the source and write to the same destination tables concurrently.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Responses are read into memory, so they need a ceiling. Without one, a host
 * that streams an endless body would exhaust the backend process — which is
 * shared across tenants, so this is not a customer's own problem to have.
 */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

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
 * A failure reported by the deployment itself, carrying Convex's own error code.
 *
 * The code is what lets a caller tell a dead cursor from a network blip — the
 * difference between resuming and rebuilding the customer's whole warehouse.
 */
export class ConvexRequestError extends StatusError {
  constructor(
    public readonly upstreamStatus: number,
    public readonly convexCode: string | null,
    message: string,
  ) {
    super(StatusError.BadRequest, message);
  }
}

/**
 * Convex's answer for a cursor it can no longer interpret: 400 with this code,
 * verified against a live backend.
 *
 * Both halves are checked wherever this is used. The caller's response is to
 * drop and rebuild every one of the customer's destination tables, and the code
 * is a string chosen by the deployment we are talking to — so a 502 whose body
 * happens to carry it must not trigger that.
 */
export const CONVEX_INVALID_CURSOR_CODE = "InvalidDataSyncCursor";
const CONVEX_INVALID_CURSOR_STATUS = 400;

export function isInvalidCursorError(error: unknown): boolean {
  return error instanceof ConvexRequestError
    && error.upstreamStatus === CONVEX_INVALID_CURSOR_STATUS
    && error.convexCode === CONVEX_INVALID_CURSOR_CODE;
}

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
 * A DNS lookup that refuses private and reserved addresses, applied at *connect*
 * time.
 *
 * Validating the hostname up front and then connecting by name would leave the
 * usual rebinding window: the name resolves to a public address for our check
 * and to 169.254.169.254 a moment later for the socket. Doing the validation
 * inside the lookup the connection itself performs closes that window, which is
 * the same approach the OAuth client takes.
 */
function safeDataSourceDnsLookup(hostname: string, options: dns.LookupOptions, callback: DnsLookupCallback): void {
  if (!shouldEnforceSsrfProtection()) {
    dns.lookup(hostname, options, callback);
    return;
  }
  publicInternetDnsLookup(hostname, options, callback, ssrfError());
}

/**
 * Parses the deployment URL and rejects what is obviously unsafe before any
 * connection is attempted. The authoritative check is the lookup above; this
 * catches literal addresses, which are never resolved.
 */
export function assertSafeDeploymentUrl(deploymentUrl: string): URL {
  let url;
  try {
    url = new URL(deploymentUrl);
  } catch {
    throw ssrfError();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw ssrfError();
  if (!url.hostname) throw ssrfError();
  if (!shouldEnforceSsrfProtection()) return url;
  if (isBlockedPrivateOrReservedIpAddress(hostnameWithoutIpv6Brackets(url.hostname))) throw ssrfError();
  return url;
}

type RawResponse = { status: number, body: string };

/**
 * One request, over `node:http(s)` rather than `fetch`.
 *
 * `fetch` gives no way to validate the address a connection actually goes to,
 * and follows redirects on its own — either of which turns this into an SSRF
 * primitive, since the URL is customer-supplied. This spells out both: the
 * socket resolves through {@link safeDataSourceDnsLookup}, and a redirect is
 * refused rather than followed, because the `Location` of a host we vetted is
 * not itself vetted.
 */
async function sendRequest(
  url: URL,
  deployKey: string,
  options: { method: "GET" | "POST", body?: string },
): Promise<RawResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return await new Promise<RawResponse>((resolve, reject) => {
    // A wall-clock deadline as well as the idle timeout below. `setTimeout` on a
    // request only fires after a period of *inactivity*, so a deployment that
    // trickles one byte every few seconds would hold the request open
    // indefinitely — and the whole point of bounding this is that a driver which
    // outlives its sync lease lets a second worker write the same destination
    // tables concurrently.
    const deadline = setTimeout(
      () => request.destroy(new Error(`exceeded ${REQUEST_TIMEOUT_MS}ms`)),
      REQUEST_TIMEOUT_MS,
    );
    const settle = {
      resolve: (value: RawResponse) => {
        clearTimeout(deadline);
        resolve(value);
      },
      reject: (error: unknown) => {
        clearTimeout(deadline);
        reject(error);
      },
    };

    const request = transport.request(url, {
      method: options.method,
      lookup: safeDataSourceDnsLookup,
      headers: {
        // Convex's own scheme for deploy keys; `Bearer` is for end-user tokens
        // and is rejected on these routes.
        authorization: `Convex ${deployKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        ...(options.body === undefined ? {} : { "content-length": Buffer.byteLength(options.body) }),
      },
    }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        settle.reject(new StatusError(
          StatusError.BadRequest,
          "The Convex deployment URL redirects. Point the source at the deployment's own URL.",
        ));
        return;
      }

      let received = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          response.destroy();
          settle.reject(new StatusError(StatusError.BadRequest, "The Convex deployment returned more data than we can read in one page."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => settle.resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", settle.reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on("error", settle.reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * One request to a Convex deployment.
 *
 * The response is parsed by {@link parseJsonPreservingBigIntegers} rather than
 * `JSON.parse`, because Convex's nanosecond version timestamps do not survive a
 * double.
 */
export async function convexRequest(
  credentials: ConvexCredentials,
  path: string,
  options: { method: "GET" | "POST", body?: unknown },
): Promise<unknown> {
  const base = assertSafeDeploymentUrl(credentials.deploymentUrl);
  const url = new URL(path, base);

  let response;
  try {
    response = await sendRequest(url, credentials.deployKey, {
      method: options.method,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (StatusError.isStatusError(error)) throw error;
    throw new StatusError(
      StatusError.BadRequest,
      `Could not reach the Convex deployment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw describeFailure(response.status, response.body, path);
  }
  // Some Convex routes acknowledge success with an empty body rather than
  // `null`, so an empty response is a result, not a parse failure.
  if (response.body.trim() === "") return null;
  try {
    return parseJsonPreservingBigIntegers(response.body);
  } catch (error) {
    throw new StatusError(
      StatusError.BadRequest,
      `The Convex deployment returned a response we could not read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * What each of Convex's error codes means for the person who has to fix it.
 *
 * Keyed on the code rather than the status, because Convex uses 403 for both a
 * rejected key and a deployment that simply has streaming export switched off —
 * and telling someone their key is wrong when it is not sends them to re-issue a
 * perfectly good key.
 *
 * A Map rather than an object literal: the code comes from the customer's
 * deployment, and `Object.prototype` keys pass the identifier check, so
 * `{"code":"toString"}` would otherwise select a function and report
 * "function toString() { [native code] }" to the customer.
 */
const FAILURE_BY_CONVEX_CODE = new Map<string, string>([
  ["StreamingExportNotEnabled",
    "This Convex deployment does not have streaming export enabled. Turn it on in the Convex dashboard under "
    + "Deployment Settings -> Integrations; it requires a Convex Professional plan."],
  ["InvalidDeployKey", 'Convex rejected the deploy key. It needs the "deployment:data:view" permission.'],
]);

/**
 * Turns a failure into something the customer can act on.
 *
 * Deliberately built from Convex's own error *code* and the status — never from
 * the response body. The deployment URL is customer-supplied, so the body is
 * attacker-chosen content; reflecting it into an error that is returned by the
 * API and persisted on `DataSource.error` would make this endpoint a way to read
 * arbitrary responses back out. The body goes to the error tracker instead,
 * where it is useful for debugging and not a channel.
 */
export function describeFailure(status: number, body: string, path: string): ConvexRequestError {
  const code = extractCode(body);
  // A cursor Convex has forgotten is expected and recovered from, so it is not
  // worth waking anyone; everything else is recorded here rather than reflected.
  // Gated on the status as well, so a 500 that merely carries that code is still
  // reported instead of disappearing. The path is ours, so naming it costs
  // nothing and saves reading a stack trace to find out which call failed.
  const isExpectedStaleCursor = status === CONVEX_INVALID_CURSOR_STATUS && code === CONVEX_INVALID_CURSOR_CODE;
  if (!isExpectedStaleCursor) {
    captureError(
      "convex-data-source-request",
      new Error(`Convex returned ${status} (${code ?? "no code"}) for ${path}`),
    );
  }

  const known = code == null ? undefined : FAILURE_BY_CONVEX_CODE.get(code);
  if (known !== undefined) return new ConvexRequestError(status, code, known);

  if (status === 401 || status === 403) {
    return new ConvexRequestError(status, code, 'Convex rejected the deploy key. It needs the "deployment:data:view" permission.');
  }
  if (status === 402) {
    return new ConvexRequestError(status, code, "Convex refused the request. Streaming export requires a Convex Professional plan.");
  }
  // An unrecognised code is deliberately NOT put in the message. It is upstream-
  // chosen text that would be shown to a project admin and persisted on
  // `DataSource.error` — `Contact_support_at_evil_example_com` is a valid
  // identifier, and our UI would lend it credibility. It stays on the error for
  // branching, and reaches engineers through the capture above.
  return new ConvexRequestError(status, code, `Convex returned ${status}.`);
}

/** Convex's structured error code, if the body is its documented error shape. */
function extractCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    // Constrained to an identifier so nothing free-form reaches a message.
    return typeof parsed.code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parsed.code) ? parsed.code : null;
  } catch {
    return null;
  }
}
