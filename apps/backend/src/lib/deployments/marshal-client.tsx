import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";

// Thin client for Marshal, the Fly.io-backed deployments runtime (apps/marshal).
// Marshal implements the Hexclave Runtime API: stateless, namespace-scoped
// (the namespace is the tenancy id), single bearer credential. This module is
// the only place backend code talks to it.

const MOCK_MARSHAL_KEY = "mock_hexclave_marshal_key";

export type MarshalDeploymentsConfig = {
  apiKey: string,
  baseUrl: string,
};

export function getMarshalDeploymentsConfigOrNull(): MarshalDeploymentsConfig | null {
  const apiKey = getEnvVariable("HEXCLAVE_MARSHAL_API_KEY", "");
  if (!apiKey) {
    return null;
  }
  let baseUrl = getEnvVariable("HEXCLAVE_MARSHAL_URL", "") || undefined;
  if (apiKey === MOCK_MARSHAL_KEY) {
    // The mock key is only allowed in dev/test — or on a localhost-hosted
    // instance, because the local QA setup runs *production builds* of the
    // backend on localhost (NODE_ENV=production) and still needs the local
    // Marshal (which itself talks to the fly-mock).
    const isLocalhostInstance = /^(.*\.)?localhost$|^127\.0\.0\.1$/.test(new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL", "http://invalid.example.com")).hostname);
    if (!["development", "test"].includes(getNodeEnvironment()) && !isLocalhostInstance) {
      throw new HexclaveAssertionError("Mock Marshal key used in production; please set the HEXCLAVE_MARSHAL_API_KEY environment variable to a real credential.");
    }
    if (!baseUrl) {
      const prefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
      baseUrl = `http://localhost:${prefix}47`;
    }
  }
  if (!baseUrl) {
    return null;
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

// Statuses that indicate OUR request was bad in a way the caller can fix
// (invalid spec, missing upload, hostname conflict). Everything else — auth
// failures (our credential), 5xx, 502 fly_api_error relays — is an
// infrastructure problem the caller can't do anything about.
const USER_INPUT_MARSHAL_STATUSES = new Set([400, 404, 409]);

export class MarshalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly marshalMessage: string,
    public readonly endpoint: string,
  ) {
    super(`Marshal API error at ${endpoint}: ${status} ${code}: ${marshalMessage}`);
    this.name = "MarshalApiError";
  }
}

/**
 * Converts an error from a Marshal call into what the client should see:
 * expected request-level rejections become clean 400/404/409s with Marshal's
 * message (Marshal never embeds infrastructure identifiers in those), while
 * everything else becomes an assertion error — logged server-side with full
 * detail, hidden from the client.
 */
export function sanitizeMarshalError(error: unknown, context: string): never {
  if (error instanceof MarshalApiError) {
    if (USER_INPUT_MARSHAL_STATUSES.has(error.status)) {
      throw new StatusError(error.status === 409 ? 409 : 400, `${context}: ${error.marshalMessage}`);
    }
    throw new HexclaveAssertionError(`${context}: Marshal request failed unexpectedly`, { cause: error });
  }
  throw error;
}

export type MarshalEnvValue = { value: string } | { ref: string };

export type MarshalServiceSpec = {
  config: {
    min_instances: number,
    max_instances: number,
    port: number,
  },
  source: { upload_id: string } | { image: string },
  env: Record<string, MarshalEnvValue>,
};

export type MarshalServiceState = {
  key: string,
  type: string,
  status: "pending" | "blocked" | "building" | "deploying" | "running" | "idle" | "degraded" | "failed" | "stopped",
  instances: number,
  revision: string | null,
  target_revision: string | null,
  outputs: Record<string, string | null>,
  domains: { hostname: string, verified: boolean, dns_records: MarshalDnsRecord[], error: string | null }[],
  error: string | null,
  observed_at_millis: number,
};

export type MarshalDnsRecord = { type: string, name: string, value: string };

export type MarshalBuild = {
  id: string,
  revision: string,
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
  has_logs: boolean,
  error: string | null,
  started_at_millis: number,
  finished_at_millis: number | null,
};

export type MarshalLogLine = {
  at_millis: number,
  stream: "stdout" | "stderr" | "system",
  instance: string | null,
  text: string,
};

export type MarshalUploadSlot = {
  id: string,
  upload_url: string,
  content_type: string,
  expires_at_millis: number,
  max_bytes: number,
};

export type MarshalApplyResult = {
  revision: string,
  changed: boolean,
  state: MarshalServiceState,
};

export type MarshalDomainResult = {
  hostname: string,
  service_key: string,
  verified: boolean,
  dns_records: MarshalDnsRecord[],
};

export class MarshalClient {
  constructor(private readonly config: MarshalDeploymentsConfig) {}

  private async fetchMarshal<T>(path: string, init?: { method?: string, body?: unknown }): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "authorization": `Bearer ${this.config.apiKey}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!response.ok) {
      const errorBody = (json ?? {}) as { error?: string, message?: string };
      throw new MarshalApiError(
        response.status,
        errorBody.error ?? "unknown",
        errorBody.message ?? text.slice(0, 500),
        `${init?.method ?? "GET"} ${path}`,
      );
    }
    return json as T;
  }

  async createUpload(ns: string): Promise<MarshalUploadSlot> {
    return await this.fetchMarshal(urlString`/v1/namespaces/${ns}/uploads`, { method: "POST" });
  }

  async putService(ns: string, serviceKey: string, spec: MarshalServiceSpec): Promise<MarshalApplyResult> {
    return await this.fetchMarshal(urlString`/v1/namespaces/${ns}/services/${serviceKey}`, { method: "PUT", body: spec });
  }

  async getService(ns: string, serviceKey: string): Promise<MarshalServiceState> {
    return await this.fetchMarshal(urlString`/v1/namespaces/${ns}/services/${serviceKey}`);
  }

  async deleteService(ns: string, serviceKey: string): Promise<void> {
    await this.fetchMarshal(urlString`/v1/namespaces/${ns}/services/${serviceKey}`, { method: "DELETE" });
  }

  async listServices(ns: string): Promise<MarshalServiceState[]> {
    const result = await this.fetchMarshal<{ services: MarshalServiceState[] }>(urlString`/v1/namespaces/${ns}`);
    return result.services;
  }

  async putDomain(ns: string, hostname: string, serviceKey: string): Promise<MarshalDomainResult> {
    return await this.fetchMarshal(urlString`/v1/namespaces/${ns}/domains/${hostname}`, { method: "PUT", body: { service_key: serviceKey } });
  }

  async deleteDomain(ns: string, hostname: string): Promise<void> {
    await this.fetchMarshal(urlString`/v1/namespaces/${ns}/domains/${hostname}`, { method: "DELETE" });
  }

  async listBuilds(ns: string, serviceKey: string, options?: { limit?: number, beforeMillis?: number }): Promise<MarshalBuild[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.beforeMillis !== undefined) params.set("before_millis", String(options.beforeMillis));
    const queryString = params.toString();
    const result = await this.fetchMarshal<{ builds: MarshalBuild[] }>(`${urlString`/v1/namespaces/${ns}/services/${serviceKey}/builds`}${queryString === "" ? "" : `?${queryString}`}`);
    return result.builds;
  }

  async getBuildLogs(ns: string, serviceKey: string, buildId: string, options?: { sinceMillis?: number }): Promise<{ lines: MarshalLogLine[], next_since_millis: number, complete: boolean }> {
    const params = new URLSearchParams();
    if (options?.sinceMillis !== undefined) params.set("since_millis", String(options.sinceMillis));
    const queryString = params.toString();
    return await this.fetchMarshal(`${urlString`/v1/namespaces/${ns}/services/${serviceKey}/builds/${buildId}/logs`}${queryString === "" ? "" : `?${queryString}`}`);
  }

  async getServiceLogs(ns: string, serviceKey: string, options?: { sinceMillis?: number, instance?: string }): Promise<{ lines: MarshalLogLine[], next_since_millis: number }> {
    const params = new URLSearchParams();
    if (options?.sinceMillis !== undefined) params.set("since_millis", String(options.sinceMillis));
    if (options?.instance !== undefined) params.set("instance", options.instance);
    const queryString = params.toString();
    return await this.fetchMarshal(`${urlString`/v1/namespaces/${ns}/services/${serviceKey}/logs`}${queryString === "" ? "" : `?${queryString}`}`);
  }
}

/**
 * Returns a Marshal client, or throws a 400 explaining deployments are
 * unconfigured. Deliberately a StatusError (not an assertion): an unconfigured
 * instance (e.g. a self-hoster without Marshal) is an expected state, and every
 * deployments route should answer it the same way.
 */
export function getMarshalClientOrThrow(): MarshalClient {
  const config = getMarshalDeploymentsConfigOrNull();
  if (config == null) {
    throw new StatusError(400, "Deployments are not configured on this Hexclave instance. Configure HEXCLAVE_MARSHAL_API_KEY (and HEXCLAVE_MARSHAL_URL if Marshal is not on the default local port) first.");
  }
  return new MarshalClient(config);
}
