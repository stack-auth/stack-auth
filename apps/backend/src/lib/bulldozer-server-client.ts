import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

const BULLDOZER_GET_MAX_ATTEMPTS = 3;
const BULLDOZER_GET_RETRY_DELAYS_MS = [25, 50];

function isTransientBulldozerTransportError(error: unknown): boolean {
  const transportErrorCodes = new Set([
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && transportErrorCodes.has(code)) return true;
    if (current.name === "SocketError" || current.name.endsWith("TimeoutError")) return true;
    current = current.cause;
  }
  return false;
}

function getBulldozerServerBaseUrl(): string {
  const configuredUrl = getEnvVariable("HEXCLAVE_BULLDOZER_SERVER_URL", "");
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }
  return `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}46`;
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function bulldozerCustomerPath(options: {
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  suffix: string,
}): string {
  return `/v1/${encodePathSegment(options.tenancyId)}/customers/${encodePathSegment(options.customerType)}/${encodePathSegment(options.customerId)}/${options.suffix}`;
}

export async function fetchBulldozerServerJson<T>(options: {
  method: "GET" | "POST",
  path: string,
  body?: unknown,
}): Promise<T> {
  const maxAttempts = options.method === "GET" ? BULLDOZER_GET_MAX_ATTEMPTS : 1;
  let response: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      response = await fetch(`${getBulldozerServerBaseUrl()}${options.path}`, {
        method: options.method,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${getEnvVariable("HEXCLAVE_BULLDOZER_SERVER_SECRET")}`,
        },
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
      });
      break;
    } catch (error) {
      if (!isTransientBulldozerTransportError(error) || attempt === maxAttempts - 1) {
        throw new HexclaveAssertionError(`Bulldozer server request failed after ${attempt + 1} attempt(s) for ${options.method} ${options.path}`, {
          method: options.method,
          path: options.path,
          attempts: attempt + 1,
          cause: error,
        });
      }
      // The GET failures seen in CI are consistent with a transient localhost
      // keep-alive reset while the bulldozer event loop is busy with LMDB/GC
      // work. Replay only GETs: a reset after a POST may mean the write already
      // reached the server, so retrying it could duplicate a side effect.
      await wait(BULLDOZER_GET_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (response === undefined) {
    throw new HexclaveAssertionError(`Bulldozer server request failed without a response for ${options.method} ${options.path}`, {
      method: options.method,
      path: options.path,
      attempts: maxAttempts,
    });
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new HexclaveAssertionError("Bulldozer server request failed", {
      method: options.method,
      path: options.path,
      status: response.status,
      responseText,
    });
  }

  return await response.json() as T;
}
