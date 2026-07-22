// Thin fetch-based client for the subset of the Vercel REST API that the
// Deployments app needs (Vercel for Platforms: one Hexclave-owned team owns a
// Vercel project per deployment service). Hand-rolled instead of @vercel/sdk so
// the backend gains no new dependency; the surface is small and stable, and the
// same client transparently talks to the vercel-mock docker service in
// dev/test. The bearer token never leaves this module (and must never be sent
// to clients or logged).

import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";

const MOCK_VERCEL_TOKEN = "mock_hexclave_vercel_key";

export type VercelDeploymentsConfig = {
  token: string,
  teamId: string,
  baseUrl: string,
};

export function getVercelDeploymentsConfigOrNull(): VercelDeploymentsConfig | null {
  const token = getEnvVariable("HEXCLAVE_VERCEL_BEARER_TOKEN", "");
  const teamId = getEnvVariable("HEXCLAVE_VERCEL_TEAM_ID", "");
  if (!token || !teamId) {
    return null;
  }
  let baseUrl = getEnvVariable("HEXCLAVE_VERCEL_API_URL", "") || undefined;
  if (token === MOCK_VERCEL_TOKEN) {
    // The mock token is only allowed in dev/test — or on a localhost-hosted
    // instance, because the local QA setup runs *production builds* of the
    // backend on localhost (NODE_ENV=production) and still needs the mock.
    const isLocalhostInstance = /^(.*\.)?localhost$|^127\.0\.0\.1$/.test(new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL", "http://invalid.example.com")).hostname);
    if (!["development", "test"].includes(getNodeEnvironment()) && !isLocalhostInstance) {
      throw new HexclaveAssertionError("Mock Vercel token used in production; please set the HEXCLAVE_VERCEL_BEARER_TOKEN environment variable to a real token.");
    }
    if (!baseUrl) {
      const prefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
      baseUrl = `http://localhost:${prefix}26`;
    }
  }
  return {
    token,
    teamId,
    baseUrl: baseUrl ?? "https://api.vercel.com",
  };
}

/**
 * Thrown for any non-OK response from the Vercel API. Deliberately NOT a
 * StatusError: route handlers must decide per call site what is safe to show
 * the user (see `sanitizeVercelError`), so an unhandled VercelApiError
 * surfaces as an internal server error rather than leaking upstream details.
 */
export class VercelApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly vercelMessage: string,
    public readonly endpoint: string,
  ) {
    super(`Vercel API error ${status} (${code}) at ${endpoint}: ${vercelMessage}`);
  }
}

// The Vercel statuses that indicate a problem with the USER's input (bad
// domain, name conflict, unprocessable payload, missing resource). Everything
// else — notably 401/403 (our shared bearer token is broken), 402 (billing),
// and 429 (team-wide rate limit) — is a Hexclave-infrastructure failure the
// customer can't fix, and Vercel's message for those can contain internals
// (team ids etc.) that must never reach API clients.
const USER_INPUT_VERCEL_STATUSES = new Set([400, 404, 409, 422]);

/**
 * Converts a VercelApiError into something safe to show to the user.
 * Input-caused 4xx errors forward Vercel's error code and message; everything
 * else becomes an assertion error (logged server-side, hidden from the
 * response) so infra outages don't masquerade as customer mistakes.
 */
export function sanitizeVercelError(error: unknown, context: string): never {
  if (error instanceof VercelApiError && USER_INPUT_VERCEL_STATUSES.has(error.status)) {
    throw new StatusError(400, `${context}: Vercel rejected the request with error code "${error.code}": ${error.vercelMessage}`);
  }
  if (error instanceof VercelApiError) {
    throw new HexclaveAssertionError(`Vercel API returned a non-input error while ${context}`, { cause: error });
  }
  throw error;
}

export type VercelProject = {
  id: string,
  name: string,
};

export type VercelDeploymentFile = {
  file: string,
  sha: string,
  size: number,
};

export type VercelDeployment = {
  id: string,
  readyState: string,
  url: string | null,
  errorMessage?: string | null,
};

export type VercelEnvVarInput = {
  key: string,
  value: string,
};

export type VercelProjectDomain = {
  name: string,
  apexName: string,
  verified: boolean,
  verification?: { type: string, domain: string, value: string, reason?: string }[],
};

export type VercelDeploymentEvent = {
  type: string,
  created: number,
  text: string,
};

export class VercelDeploymentsClient {
  constructor(private readonly config: VercelDeploymentsConfig) {}

  private async fetchVercel(path: string, init: RequestInit & { rawBody?: Uint8Array, extraHeaders?: Record<string, string> } = {}): Promise<any> {
    const url = new URL(path, this.config.baseUrl);
    url.searchParams.set("teamId", this.config.teamId);
    const response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      headers: {
        "authorization": `Bearer ${this.config.token}`,
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...init.extraHeaders,
      },
      // rawBody wins over body. The copy into a fresh ArrayBuffer is needed
      // because TS's BodyInit doesn't accept Uint8Array<ArrayBufferLike>
      // (SharedArrayBuffer-backed views are not valid bodies); it also
      // guarantees we never send trailing bytes of a larger shared buffer.
      body: init.rawBody != null ? new Uint8Array(init.rawBody).slice().buffer : init.body,
    });
    const text = await response.text();
    let json: any = undefined;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      // Non-JSON response body; handled below.
    }
    if (!response.ok) {
      const code = typeof json?.error?.code === "string" ? json.error.code : "unknown";
      const message = typeof json?.error?.message === "string" ? json.error.message : `HTTP ${response.status}`;
      throw new VercelApiError(response.status, code, message, `${init.method ?? "GET"} ${path}`);
    }
    if (json === undefined && text !== "") {
      throw new HexclaveAssertionError(`Vercel API returned OK but non-JSON body at ${path}`);
    }
    return json;
  }

  async createProject(options: { name: string, framework?: string }): Promise<VercelProject> {
    const json = await this.fetchVercel("/v10/projects", {
      method: "POST",
      body: JSON.stringify({
        name: options.name,
        ...(options.framework != null ? { framework: options.framework } : {}),
      }),
    });
    if (typeof json?.id !== "string") {
      throw new HexclaveAssertionError("Vercel createProject response is missing an id", { json });
    }
    return { id: json.id, name: json.name };
  }

  async deleteProject(projectIdOrName: string): Promise<void> {
    await this.fetchVercel(urlString`/v9/projects/${projectIdOrName}`, { method: "DELETE" });
  }

  async getProject(projectIdOrName: string): Promise<VercelProject> {
    const json = await this.fetchVercel(urlString`/v9/projects/${projectIdOrName}`);
    if (typeof json?.id !== "string") {
      throw new HexclaveAssertionError("Vercel getProject response is missing an id", { json });
    }
    return { id: json.id, name: json.name };
  }

  /**
   * Uploads a single file to Vercel's content-addressed file store. Files are
   * referenced by SHA-1 in `createDeployment`. Uploading an already-known SHA
   * is a no-op on Vercel's side.
   */
  async uploadFile(sha1Hex: string, data: Uint8Array): Promise<void> {
    await this.fetchVercel("/v2/files", {
      method: "POST",
      rawBody: data,
      extraHeaders: {
        "content-type": "application/octet-stream",
        "x-vercel-digest": sha1Hex,
        "content-length": data.length.toString(),
      },
    });
  }

  async createDeployment(options: {
    projectId: string,
    projectName: string,
    target: string,
    files: VercelDeploymentFile[],
    projectSettings: {
      framework?: string,
      installCommand?: string,
      buildCommand?: string,
      outputDirectory?: string,
    },
  }): Promise<VercelDeployment> {
    const json = await this.fetchVercel("/v13/deployments?skipAutoDetectionConfirmation=1", {
      method: "POST",
      body: JSON.stringify({
        name: options.projectName,
        project: options.projectId,
        target: options.target,
        files: options.files,
        projectSettings: {
          framework: options.projectSettings.framework ?? null,
          installCommand: options.projectSettings.installCommand ?? null,
          buildCommand: options.projectSettings.buildCommand ?? null,
          outputDirectory: options.projectSettings.outputDirectory ?? null,
        },
      }),
    });
    if (typeof json?.id !== "string") {
      throw new HexclaveAssertionError("Vercel createDeployment response is missing an id", { json });
    }
    return {
      id: json.id,
      readyState: typeof json.readyState === "string" ? json.readyState : "QUEUED",
      url: typeof json.url === "string" ? json.url : null,
    };
  }

  async getDeployment(deploymentId: string): Promise<VercelDeployment> {
    const json = await this.fetchVercel(urlString`/v13/deployments/${deploymentId}`);
    return {
      id: deploymentId,
      readyState: typeof json?.readyState === "string" ? json.readyState : "QUEUED",
      url: typeof json?.url === "string" ? json.url : null,
      errorMessage: typeof json?.errorMessage === "string" ? json.errorMessage : null,
    };
  }

  async getDeploymentEvents(deploymentId: string): Promise<VercelDeploymentEvent[]> {
    const json = await this.fetchVercel(urlString`/v3/deployments/${deploymentId}/events` + "?builds=1&limit=-1");
    if (!Array.isArray(json)) {
      return [];
    }
    return json.map((event: any) => ({
      type: typeof event?.type === "string" ? event.type : "stdout",
      created: typeof event?.created === "number" ? event.created : 0,
      text: typeof event?.payload?.text === "string" ? event.payload.text : (typeof event?.text === "string" ? event.text : ""),
    }));
  }

  /**
   * Pushes env vars to the Vercel project as encrypted values for all targets.
   * Existing vars with the same key are overwritten (upsert).
   */
  async upsertEnvVars(projectId: string, envVars: VercelEnvVarInput[]): Promise<void> {
    if (envVars.length === 0) return;
    await this.fetchVercel(urlString`/v10/projects/${projectId}/env` + "?upsert=true", {
      method: "POST",
      body: JSON.stringify(envVars.map((envVar) => ({
        key: envVar.key,
        value: envVar.value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }))),
    });
  }

  async listEnvVarKeys(projectId: string): Promise<{ id: string, key: string }[]> {
    const json = await this.fetchVercel(urlString`/v9/projects/${projectId}/env`);
    const envs = Array.isArray(json?.envs) ? json.envs : [];
    return envs
      .filter((env: any) => typeof env?.id === "string" && typeof env?.key === "string")
      .map((env: any) => ({ id: env.id, key: env.key }));
  }

  async deleteEnvVar(projectId: string, envId: string): Promise<void> {
    await this.fetchVercel(urlString`/v9/projects/${projectId}/env/${envId}`, { method: "DELETE" });
  }

  async addProjectDomain(projectId: string, hostname: string): Promise<VercelProjectDomain> {
    const json = await this.fetchVercel(urlString`/v10/projects/${projectId}/domains`, {
      method: "POST",
      body: JSON.stringify({ name: hostname }),
    });
    return parseProjectDomain(json, hostname);
  }

  async getProjectDomain(projectId: string, hostname: string): Promise<VercelProjectDomain> {
    const json = await this.fetchVercel(urlString`/v9/projects/${projectId}/domains/${hostname}`);
    return parseProjectDomain(json, hostname);
  }

  /**
   * Asks Vercel to re-check the domain's DNS records. Returns the refreshed
   * domain. Vercel returns an error only for unknown domains; an unverified
   * domain simply comes back with `verified: false`.
   */
  async verifyProjectDomain(projectId: string, hostname: string): Promise<VercelProjectDomain> {
    const json = await this.fetchVercel(urlString`/v9/projects/${projectId}/domains/${hostname}/verify`, { method: "POST" });
    return parseProjectDomain(json, hostname);
  }

  async removeProjectDomain(projectId: string, hostname: string): Promise<void> {
    await this.fetchVercel(urlString`/v9/projects/${projectId}/domains/${hostname}`, { method: "DELETE" });
  }

  /**
   * Whether the domain's DNS records actually point at Vercel. This is
   * independent of `VercelProjectDomain.verified`, which only covers domain
   * OWNERSHIP (a TXT challenge, required when another Vercel team already
   * uses the domain) — a freshly added, unclaimed domain reports
   * `verified: true` while its DNS is still entirely unconfigured.
   */
  async isDomainMisconfigured(hostname: string): Promise<boolean> {
    const json = await this.fetchVercel(urlString`/v6/domains/${hostname}/config`);
    return json?.misconfigured !== false;
  }

  /**
   * Opens Vercel's runtime log stream for a deployment (NDJSON, live tail —
   * Vercel holds the connection for up to ~5 minutes and only emits lines for
   * traffic that happens while it's open; there is no historical read-back on
   * this endpoint). Returns the raw upstream Response for the caller to pipe.
   */
  async fetchRuntimeLogsStream(projectId: string, deploymentId: string): Promise<Response> {
    const url = new URL(urlString`/v1/projects/${projectId}/deployments/${deploymentId}/runtime-logs`, this.config.baseUrl);
    url.searchParams.set("teamId", this.config.teamId);
    url.searchParams.set("format", "json");
    const response = await fetch(url.toString(), {
      headers: { "authorization": `Bearer ${this.config.token}` },
    });
    if (!response.ok) {
      const text = await response.text();
      let json: any = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        // Non-JSON error body; fall through to the generic message.
      }
      const code = typeof json?.error?.code === "string" ? json.error.code : "unknown";
      const message = typeof json?.error?.message === "string" ? json.error.message : `HTTP ${response.status}`;
      throw new VercelApiError(response.status, code, message, "GET runtime-logs");
    }
    return response;
  }

  /**
   * Turns off Vercel's deployment protection (SSO auth wall) for a project.
   * New projects on a team have it enabled by default, which would make every
   * customer deployment unreachable to the public.
   */
  async disableDeploymentProtection(projectId: string): Promise<void> {
    await this.fetchVercel(urlString`/v9/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ ssoProtection: null }),
    });
  }
}

function parseProjectDomain(json: any, hostname: string): VercelProjectDomain {
  return {
    name: typeof json?.name === "string" ? json.name : hostname,
    apexName: typeof json?.apexName === "string" ? json.apexName : hostname,
    verified: json?.verified === true,
    verification: Array.isArray(json?.verification) ? json.verification.map((v: any) => ({
      type: typeof v?.type === "string" ? v.type : "TXT",
      domain: typeof v?.domain === "string" ? v.domain : hostname,
      value: typeof v?.value === "string" ? v.value : "",
      reason: typeof v?.reason === "string" ? v.reason : undefined,
    })) : undefined,
  };
}

/**
 * Returns the configured Vercel client, or throws a clean 400 that tells the
 * operator how to fix it. Never a 5xx: an unconfigured instance is an expected
 * state for self-hosters who don't use the Deployments app.
 */
export function getVercelDeploymentsClientOrThrow(): VercelDeploymentsClient {
  const config = getVercelDeploymentsConfigOrNull();
  if (config == null) {
    throw new StatusError(400, "Vercel deployments are not configured on this Hexclave instance. Set the HEXCLAVE_VERCEL_BEARER_TOKEN and HEXCLAVE_VERCEL_TEAM_ID environment variables on the server to enable them.");
  }
  return new VercelDeploymentsClient(config);
}
