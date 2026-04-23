import { envVars } from "../../env";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

// Runs a fetch with a single AbortController that stays alive until the `consume`
// callback finishes reading the body. Clearing the timer as soon as headers arrive
// (the obvious version) leaves `.text()` / `.json()` free to hang on a stalled body,
// which would defeat the point of the timeout on a server-auth path.
async function withFetchTimeout<T>(
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

export type OidcFederationTokenStore = {
  getAccessToken(): Promise<string>,
};

export type OidcFederationTokenStoreOptions = {
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
};

type CachedToken = { accessToken: string, refreshAtMs: number };
type CachedFailure = { error: OidcFederationExchangeError, expiresAtMs: number };

const NEGATIVE_CACHE_MS = 2_000;

export class OidcFederationExchangeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OidcFederationExchangeError";
  }
}

export function createOidcFederationTokenStore(options: {
  projectId: string,
  /** String or getter. Use a getter when the surrounding interface can itself recompute the base URL. */
  apiBaseUrl: string | (() => string),
  branchId?: string,
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
}): OidcFederationTokenStore {
  const baseUrl = options.apiBaseUrl;
  const getApiBaseUrl = typeof baseUrl === "function" ? baseUrl : () => baseUrl;
  const label = options.sourceLabel ?? "oidc";
  let cached: CachedToken | null = null;
  let lastFailure: CachedFailure | null = null;
  let inFlight: Promise<CachedToken> | null = null;

  // `refreshAtMs` / `now` / `expiresAtMs` are all compared to each other — use
  // `performance.now()` so wall-clock jumps (NTP corrections, suspend/resume, manual
  // clock changes) can't make us reuse an expired token or extend negative caching.
  const shouldRefresh = (now: number) => !cached || cached.refreshAtMs - now <= 5_000;

  const doExchange = async (): Promise<CachedToken> => {
    let subjectToken: string;
    try {
      subjectToken = await options.getOidcToken();
    } catch (cause) {
      throw new OidcFederationExchangeError(`failed to obtain OIDC token from ${label}`, cause);
    }
    if (!subjectToken) {
      throw new OidcFederationExchangeError(`${label} returned an empty OIDC token`);
    }

    const url = new URL("/api/v1/auth/oidc-federation/exchange", getApiBaseUrl());
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-stack-project-id": options.projectId,
    };
    if (options.branchId) headers["x-stack-branch-id"] = options.branchId;

    let result: { kind: "ok", json: { access_token?: unknown, expires_in?: unknown } } | { kind: "httpError", status: number, body: string };
    try {
      result = await withFetchTimeout(
        url.toString(),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            grant_type: GRANT_TYPE,
            subject_token: subjectToken,
            subject_token_type: SUBJECT_TOKEN_TYPE,
          }),
        },
        async (response) => {
          if (!response.ok) {
            const body = await response.text().catch(() => "<unreadable>");
            return { kind: "httpError" as const, status: response.status, body };
          }
          const json = await response.json() as { access_token?: unknown, expires_in?: unknown };
          return { kind: "ok" as const, json };
        },
      );
    } catch (cause) {
      throw new OidcFederationExchangeError("network error during OIDC federation exchange", cause);
    }

    if (result.kind === "httpError") {
      throw new OidcFederationExchangeError(
        `OIDC federation exchange returned ${result.status}: ${result.body.slice(0, 500)}`,
      );
    }

    const { json } = result;
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
      throw new OidcFederationExchangeError("OIDC federation exchange response missing access_token or expires_in");
    }
    const refreshAtMs = performance.now() + Math.floor(json.expires_in * 1000 * 0.8);
    return { accessToken: json.access_token, refreshAtMs };
  };

  const getAccessToken = async (): Promise<string> => {
    const now = performance.now();
    if (cached && !shouldRefresh(now)) return cached.accessToken;
    // Negative cache: if the last exchange failed very recently, reject fast instead of
    // racing a second exchange while the first's awaiters are still settling. This
    // prevents retry stampedes against the backend during an outage.
    if (lastFailure && lastFailure.expiresAtMs > now) {
      throw lastFailure.error;
    }
    // Dedupe concurrent refreshes: the first caller creates `inFlight`; any caller
    // arriving before it resolves awaits the same promise. If `doExchange()` rejects,
    // every waiter sees that rejection (shared promise).
    if (inFlight) {
      const value = await inFlight;
      return value.accessToken;
    }
    inFlight = (async () => {
      try {
        const value = await doExchange();
        cached = value;
        lastFailure = null;
        return value;
      } catch (err) {
        lastFailure = {
          error: err instanceof OidcFederationExchangeError ? err : new OidcFederationExchangeError(String(err), err),
          expiresAtMs: performance.now() + NEGATIVE_CACHE_MS,
        };
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    const value = await inFlight;
    return value.accessToken;
  };

  return { getAccessToken };
}

export function createOidcFederationTokenStoreForServerApp(options: {
  projectId: string,
  apiBaseUrl: string | (() => string),
  extraRequestHeaders: Record<string, string>,
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
}): OidcFederationTokenStore {
  const extraRequestHeaders = new Headers(options.extraRequestHeaders);
  return createOidcFederationTokenStore({
    projectId: options.projectId,
    apiBaseUrl: options.apiBaseUrl,
    branchId: extraRequestHeaders.get("x-stack-branch-id") ?? undefined,
    getOidcToken: options.getOidcToken,
    sourceLabel: options.sourceLabel,
  });
}

export function fromVercelOidc(options?: {
  getRequest?: () => Request | null | undefined,
}): OidcFederationTokenStoreOptions {
  return {
    sourceLabel: "Vercel OIDC",
    getOidcToken: async () => {
      const envToken = envVars.VERCEL_OIDC_TOKEN;
      if (envToken) return envToken;
      const req = options?.getRequest?.();
      const headerToken = req?.headers.get("x-vercel-oidc-token");
      if (headerToken) return headerToken;
      throw new Error(
        "VERCEL_OIDC_TOKEN not found. In Vercel Functions, pass `getRequest: () => request` so the SDK can read the `x-vercel-oidc-token` header.",
      );
    },
  };
}

export function fromGithubActionsOidc(options: { audience: string }): OidcFederationTokenStoreOptions {
  return {
    sourceLabel: "GitHub Actions OIDC",
    getOidcToken: async () => {
      const requestUrl = envVars.ACTIONS_ID_TOKEN_REQUEST_URL;
      const requestToken = envVars.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      if (!requestUrl || !requestToken) {
        throw new Error(
          "GitHub Actions OIDC env vars are not set. Ensure the job has `permissions: { id-token: write }`.",
        );
      }
      const url = new URL(requestUrl);
      url.searchParams.set("audience", options.audience);
      return await withFetchTimeout(
        url.toString(),
        { headers: { authorization: `Bearer ${requestToken}` } },
        async (response) => {
          if (!response.ok) {
            throw new Error(`GitHub Actions OIDC request failed: ${response.status}`);
          }
          const body = await response.json() as { value?: unknown };
          if (typeof body.value !== "string") throw new Error("GitHub Actions OIDC response is missing `value`");
          return body.value;
        },
      );
    },
  };
}

export function fromGcpMetadata(options: { audience: string }): OidcFederationTokenStoreOptions {
  return {
    sourceLabel: "GCP metadata server",
    getOidcToken: async () => {
      const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
      url.searchParams.set("audience", options.audience);
      return await withFetchTimeout(
        url.toString(),
        { headers: { "metadata-flavor": "Google" } },
        async (response) => {
          if (!response.ok) {
            throw new Error(`GCP metadata server returned ${response.status}. Is this running on a GCP workload?`);
          }
          return await response.text();
        },
      );
    },
  };
}

export function fromOidcToken(getOidcToken: () => Promise<string>, sourceLabel = "custom OIDC source"): OidcFederationTokenStoreOptions {
  return { getOidcToken, sourceLabel };
}
