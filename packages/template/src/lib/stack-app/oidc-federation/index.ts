import { envVars } from "../../env";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";

export type OidcFederationTokenStore = {
  getAccessToken(): Promise<string>,
};

export type OidcFederationTokenStoreOptions = {
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
};

type CachedToken = { accessToken: string, refreshAtMs: number };

export class OidcFederationExchangeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OidcFederationExchangeError";
  }
}

export function createOidcFederationTokenStore(options: {
  projectId: string,
  apiBaseUrl: string,
  branchId?: string,
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
}): OidcFederationTokenStore {
  const label = options.sourceLabel ?? "oidc";
  let cached: CachedToken | null = null;
  let inFlight: Promise<CachedToken> | null = null;

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

    const url = new URL("/api/v1/auth/oidc-federation/exchange", options.apiBaseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-stack-project-id": options.projectId,
    };
    if (options.branchId) headers["x-stack-branch-id"] = options.branchId;

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          grant_type: GRANT_TYPE,
          subject_token: subjectToken,
          subject_token_type: SUBJECT_TOKEN_TYPE,
        }),
      });
    } catch (cause) {
      throw new OidcFederationExchangeError("network error during OIDC federation exchange", cause);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      throw new OidcFederationExchangeError(
        `OIDC federation exchange returned ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const json = await response.json() as { access_token?: unknown, expires_in?: unknown };
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
      throw new OidcFederationExchangeError("OIDC federation exchange response missing access_token or expires_in");
    }
    const refreshAtMs = Date.now() + Math.floor(json.expires_in * 1000 * 0.8);
    return { accessToken: json.access_token, refreshAtMs };
  };

  const getAccessToken = async (): Promise<string> => {
    const now = Date.now();
    if (cached && !shouldRefresh(now)) return cached.accessToken;
    // Dedupe concurrent refreshes: the first caller creates `inFlight`; any caller
    // arriving before it resolves awaits the same promise. If `doExchange()` rejects,
    // every waiter sees that rejection (shared promise), and `inFlight` is cleared
    // in `finally` so the next call retries instead of re-throwing a stale error.
    if (inFlight) {
      const value = await inFlight;
      return value.accessToken;
    }
    inFlight = (async () => {
      try {
        const value = await doExchange();
        cached = value;
        return value;
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
  apiBaseUrl: string,
  extraRequestHeaders: Record<string, string>,
  getOidcToken: () => Promise<string>,
  sourceLabel?: string,
}): OidcFederationTokenStore {
  return createOidcFederationTokenStore({
    projectId: options.projectId,
    apiBaseUrl: options.apiBaseUrl,
    branchId: options.extraRequestHeaders["x-stack-branch-id"],
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
      const response = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${requestToken}` },
      });
      if (!response.ok) {
        throw new Error(`GitHub Actions OIDC request failed: ${response.status}`);
      }
      const body = await response.json() as { value?: unknown };
      if (typeof body.value !== "string") throw new Error("GitHub Actions OIDC response is missing `value`");
      return body.value;
    },
  };
}

export function fromGcpMetadata(options: { audience: string }): OidcFederationTokenStoreOptions {
  return {
    sourceLabel: "GCP metadata server",
    getOidcToken: async () => {
      const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
      url.searchParams.set("audience", options.audience);
      const response = await fetch(url.toString(), {
        headers: { "metadata-flavor": "Google" },
      });
      if (!response.ok) {
        throw new Error(`GCP metadata server returned ${response.status}. Is this running on a GCP workload?`);
      }
      return await response.text();
    },
  };
}

export function fromOidcToken(getOidcToken: () => Promise<string>, sourceLabel = "custom OIDC source"): OidcFederationTokenStoreOptions {
  return { getOidcToken, sourceLabel };
}
