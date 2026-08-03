import { getConfig, MOCK_FLY_TOKEN } from "../config.js";

// Thin client for the three Fly API surfaces Marshal talks to, plus the Docker registry.
// One instance per (org, token) — resolved per namespace via resolveNamespaceOrg.
//
// Auth quirk (smoke-verified): the Machines REST API and GraphQL accept
// "Authorization: Bearer <token>", but the logs API only accepts the raw macaroon scheme
// ("Authorization: FlyV1 fm2_..."), i.e. the token verbatim.

export class FlyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly flyMessage: string,
  ) {
    super(`Fly API error at ${endpoint}: ${status} ${flyMessage}`);
    this.name = "FlyApiError";
  }
}

export type FlyMachine = {
  id: string,
  name: string,
  state: string,
  region: string,
  instance_id: string,
  config: {
    image: string,
    env?: Record<string, string>,
    metadata?: Record<string, string>,
    [key: string]: unknown,
  },
};

export type FlyLogEntry = {
  id: string,
  attributes: {
    timestamp: string,
    message: string,
    level: string,
    instance: string | null,
    region: string,
    meta?: { event?: { provider?: string } | null } | null,
  },
};

export type FlyCertificate = {
  id: string,
  hostname: string,
  configured: boolean,
  acmeDnsConfigured: boolean,
  clientStatus: string,
  dnsValidationHostname: string,
  dnsValidationTarget: string,
  isApex: boolean,
  issued: { nodes: { type: string, expiresAt: string }[] },
};

export type FlyAppIps = {
  sharedIpv4: string | null,
  dedicated: { id: string, address: string, type: string }[],
};

export class FlyClient {
  constructor(
    private readonly token: string,
    public readonly orgSlug: string,
  ) {}

  // A read has no body to re-send, so retry it once on a network-level failure (undici
  // surfaces a keep-alive socket reset as a TypeError). Writes are never retried here — a
  // duplicated machine create is worse than a surfaced error.
  private async retryReadOnSocketReset(doFetch: () => Promise<Response>): Promise<Response> {
    try {
      return await doFetch();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return await doFetch();
    }
  }

  private async fetchWithReadRetry(url: string, init: RequestInit & { method: string }): Promise<Response> {
    if (init.method === "GET" || init.method === "HEAD") {
      return await this.retryReadOnSocketReset(() => fetch(url, init));
    }
    return await fetch(url, init);
  }

  private async fetchMachinesApi<T>(path: string, init?: { method?: string, body?: unknown, allow404?: boolean }): Promise<T | null> {
    const { fly } = getConfig();
    const response = await this.fetchWithReadRetry(`${fly.machinesApiUrl}/v1${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "authorization": `Bearer ${this.token}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (response.status === 404 && init?.allow404) {
      await response.arrayBuffer();
      return null;
    }
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 500);
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        // non-JSON error body; keep the raw text
      }
      throw new FlyApiError(response.status, `machines ${init?.method ?? "GET"} ${path}`, message);
    }
    return text === "" ? null : JSON.parse(text) as T;
  }

  // allowNotFound: real Fly answers reads on nonexistent apps with a
  // "Could not find App" GraphQL error (not a null app); the read paths treat
  // that as "no data" so a service without an app reads as empty.
  private async fetchGraphql<T>(query: string, variables: Record<string, unknown>, options?: { allowNotFound?: boolean, read?: boolean }): Promise<T | null> {
    const { fly } = getConfig();
    const doFetch = () => fetch(fly.graphqlApiUrl, {
      method: "POST",
      headers: { "authorization": `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    // Read queries get the same one-shot socket-reset retry the REST reads get.
    const response = options?.read ? await this.retryReadOnSocketReset(doFetch) : await doFetch();
    // Read as text and parse defensively: a non-JSON upstream body (a proxy's 502 HTML page)
    // must surface as a FlyApiError(502-ish), not a bare SyntaxError → generic 500.
    const text = await response.text();
    let json: { data?: T, errors?: { message: string }[] };
    try {
      json = JSON.parse(text) as { data?: T, errors?: { message: string }[] };
    } catch {
      throw new FlyApiError(response.status, "graphql", text.slice(0, 500) || `HTTP ${response.status} (non-JSON body)`);
    }
    const errors = json.errors ?? [];
    if (options?.allowNotFound && errors.length > 0 && errors.every((error) => /could not find/i.test(error.message))) {
      return null;
    }
    if (!response.ok || errors.length > 0) {
      throw new FlyApiError(response.status, "graphql", errors.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
    }
    return json.data as T;
  }

  // -------------------------------------------------------------------------
  // Apps

  async getApp(name: string): Promise<{ name: string, status: string } | null> {
    return await this.fetchMachinesApi<{ name: string, status: string }>(`/apps/${name}`, { allow404: true });
  }

  async createApp(name: string, network: string): Promise<void> {
    await this.fetchMachinesApi(`/apps`, {
      method: "POST",
      body: { app_name: name, org_slug: this.orgSlug, network },
    });
  }

  async ensureApp(name: string, network: string): Promise<void> {
    const existing = await this.getApp(name);
    if (existing !== null) return;
    try {
      await this.createApp(name, network);
    } catch (error) {
      // Lost a create race — the app now existing is the state we wanted.
      if (error instanceof FlyApiError && (error.status === 409 || error.status === 422) && (await this.getApp(name)) !== null) return;
      throw error;
    }
  }

  async deleteApp(name: string): Promise<void> {
    await this.fetchMachinesApi(`/apps/${name}?force=true`, { method: "DELETE", allow404: true });
  }

  // -------------------------------------------------------------------------
  // Machines

  async listMachines(app: string): Promise<FlyMachine[]> {
    return await this.fetchMachinesApi<FlyMachine[]>(`/apps/${app}/machines`, { allow404: true }) ?? [];
  }

  async getMachine(app: string, machineId: string): Promise<FlyMachine | null> {
    return await this.fetchMachinesApi<FlyMachine>(`/apps/${app}/machines/${machineId}`, { allow404: true });
  }

  async createMachine(app: string, body: { name?: string, region: string, config: Record<string, unknown> }): Promise<FlyMachine> {
    const machine = await this.fetchMachinesApi<FlyMachine>(`/apps/${app}/machines`, { method: "POST", body });
    if (machine === null) throw new FlyApiError(500, `machines POST /apps/${app}/machines`, "empty response");
    return machine;
  }

  async updateMachine(app: string, machineId: string, config: Record<string, unknown>): Promise<FlyMachine> {
    const machine = await this.fetchMachinesApi<FlyMachine>(`/apps/${app}/machines/${machineId}`, { method: "POST", body: { config } });
    if (machine === null) throw new FlyApiError(500, `machines POST /apps/${app}/machines/${machineId}`, "empty response");
    return machine;
  }

  async destroyMachine(app: string, machineId: string): Promise<void> {
    await this.fetchMachinesApi(`/apps/${app}/machines/${machineId}?force=true`, { method: "DELETE", allow404: true });
  }

  async startMachine(app: string, machineId: string): Promise<void> {
    await this.fetchMachinesApi(`/apps/${app}/machines/${machineId}/start`, { method: "POST" });
  }

  // The /wait endpoint caps timeout at 60s (smoke-verified: larger values → 400), so waits
  // longer than that loop here.
  async waitForMachineState(app: string, machineId: string, state: "started" | "stopped" | "destroyed", options?: { instanceId?: string, totalTimeoutSeconds?: number }): Promise<void> {
    const deadline = Date.now() + (options?.totalTimeoutSeconds ?? 60) * 1000;
    for (;;) {
      const remainingSeconds = Math.ceil((deadline - Date.now()) / 1000);
      // Don't start another wait once the deadline has passed (a fast-returning 408 could
      // otherwise loop tightly against the API for the whole budget).
      if (remainingSeconds <= 0) throw new FlyApiError(408, `machines wait /apps/${app}/machines/${machineId}`, `timed out waiting for state ${state}`);
      const params = new URLSearchParams({ state, timeout: String(Math.min(60, remainingSeconds)) });
      if (options?.instanceId !== undefined) params.set("instance_id", options.instanceId);
      try {
        await this.fetchMachinesApi(`/apps/${app}/machines/${machineId}/wait?${params.toString()}`);
        return;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        // Timeout errors surface as 408; anything else is real.
        if (!(error instanceof FlyApiError) || error.status !== 408) throw error;
        // Small backoff so a proxy timing out ahead of Fly's own long-poll can't spin.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // -------------------------------------------------------------------------
  // IPs (GraphQL)

  async getAppIps(app: string): Promise<FlyAppIps> {
    const data = await this.fetchGraphql<{ app: { sharedIpAddress: string | null, ipAddresses: { nodes: { id: string, address: string, type: string }[] } } | null }>(`
      query($app: String!) {
        app(name: $app) { sharedIpAddress ipAddresses { nodes { id address type } } }
      }`, { app }, { allowNotFound: true, read: true });
    return {
      sharedIpv4: data?.app?.sharedIpAddress ?? null,
      dedicated: data?.app?.ipAddresses.nodes ?? [],
    };
  }

  async allocateIp(app: string, type: "shared_v4" | "v6" | "private_v6", network?: string): Promise<void> {
    await this.fetchGraphql(`
      mutation($input: AllocateIPAddressInput!) {
        allocateIpAddress(input: $input) { app { name } }
      }`, { input: { appId: app, type, ...(network !== undefined ? { network } : {}) } });
  }

  async releaseIpById(app: string, ipAddressId: string): Promise<void> {
    await this.fetchGraphql(`
      mutation($input: ReleaseIPAddressInput!) { releaseIpAddress(input: $input) { app { name } } }`,
      { input: { appId: app, ipAddressId } });
  }

  async releaseIpByAddress(app: string, ip: string): Promise<void> {
    await this.fetchGraphql(`
      mutation($input: ReleaseIPAddressInput!) { releaseIpAddress(input: $input) { app { name } } }`,
      { input: { appId: app, ip } });
  }

  async ensureFlycastIp(app: string, network: string): Promise<void> {
    const ips = await this.getAppIps(app);
    if (ips.dedicated.some((ip) => ip.type === "private_v6")) return;
    await this.allocateIp(app, "private_v6", network);
  }

  // -------------------------------------------------------------------------
  // Certificates (GraphQL)

  private static readonly CERTIFICATE_FIELDS = `
    id hostname configured acmeDnsConfigured clientStatus
    dnsValidationHostname dnsValidationTarget isApex
    issued { nodes { type expiresAt } }`;

  async addCertificate(app: string, hostname: string): Promise<FlyCertificate> {
    const data = await this.fetchGraphql<{ addCertificate: { certificate: FlyCertificate } }>(`
      mutation($appId: ID!, $hostname: String!) {
        addCertificate(appId: $appId, hostname: $hostname) {
          certificate { ${FlyClient.CERTIFICATE_FIELDS} }
        }
      }`, { appId: app, hostname });
    if (data === null) throw new FlyApiError(500, "graphql addCertificate", "empty response");
    return data.addCertificate.certificate;
  }

  async deleteCertificate(app: string, hostname: string): Promise<void> {
    try {
      await this.fetchGraphql(`
        mutation($appId: ID!, $hostname: String!) {
          deleteCertificate(appId: $appId, hostname: $hostname) { certificate { id } }
        }`, { appId: app, hostname });
    } catch (error) {
      // Deleting an already-gone certificate (or one on a deleted app) is a no-op.
      if (error instanceof FlyApiError && /not found|could not find/i.test(error.flyMessage)) return;
      throw error;
    }
  }

  async getCertificate(app: string, hostname: string): Promise<FlyCertificate | null> {
    const data = await this.fetchGraphql<{ app: { certificate: FlyCertificate | null } | null }>(`
      query($app: String!, $hostname: String!) {
        app(name: $app) { certificate(hostname: $hostname) { ${FlyClient.CERTIFICATE_FIELDS} } }
      }`, { app, hostname }, { allowNotFound: true, read: true });
    return data?.app?.certificate ?? null;
  }

  async listCertificates(app: string): Promise<FlyCertificate[]> {
    const data = await this.fetchGraphql<{ app: { certificates: { nodes: FlyCertificate[] } } | null }>(`
      query($app: String!) {
        app(name: $app) { certificates { nodes { ${FlyClient.CERTIFICATE_FIELDS} } } }
      }`, { app }, { allowNotFound: true, read: true });
    return data?.app?.certificates.nodes ?? [];
  }

  // -------------------------------------------------------------------------
  // Logs API

  async getLogs(app: string, options?: { nextToken?: string, instance?: string }): Promise<{ entries: FlyLogEntry[], nextToken: string | null }> {
    const { fly } = getConfig();
    const params = new URLSearchParams();
    if (options?.nextToken !== undefined) params.set("next_token", options.nextToken);
    if (options?.instance !== undefined) params.set("instance", options.instance);
    const queryString = params.toString();
    const response = await fetch(`${fly.logsApiUrl}/apps/${app}/logs${queryString === "" ? "" : `?${queryString}`}`, {
      // Raw macaroon scheme — "Bearer" is rejected with a 401 here (smoke-verified).
      headers: { "authorization": this.token },
    });
    if (!response.ok) {
      await response.arrayBuffer();
      // The logs API 401s (and 404s) for apps that don't exist and can't distinguish that
      // from an auth failure — treat only those as "no logs" so a service without an app
      // reads as empty. 429 (rate limit) and 5xx MUST throw: swallowing them would silently
      // truncate a durable build-log drain or hide a broken token as "no logs".
      if (response.status === 401 || response.status === 404) return { entries: [], nextToken: null };
      throw new FlyApiError(response.status, `logs GET /apps/${app}/logs`, "logs API error");
    }
    const json = await response.json() as { data?: FlyLogEntry[], meta?: { next_token?: string } };
    return {
      entries: json.data ?? [],
      nextToken: json.meta?.next_token === undefined || json.meta.next_token === "" ? null : json.meta.next_token,
    };
  }

  // -------------------------------------------------------------------------
  // Docker registry (registry.fly.io speaks the standard v2 protocol; basic auth with
  // user "x" and the org token as password — smoke-verified, works with or without the
  // "FlyV1 " prefix)

  private registryAuthHeader(): string {
    return `Basic ${Buffer.from(`x:${this.token}`).toString("base64")}`;
  }

  registryAuthBase64(): string {
    return Buffer.from(`x:${this.token}`).toString("base64");
  }

  async resolveImageDigest(app: string, tag: string): Promise<string | null> {
    const { fly } = getConfig();
    // The registry has no mock; when the mock Fly token is in use, don't send a real HTTPS
    // request to registry.fly.io with a sentinel credential (surprising egress + a 401 that
    // surfaces as "digest could not be resolved"). Mock builds always supply the digest in
    // their metadata, so this fallback is never legitimately reached under the mock.
    if (this.token === MOCK_FLY_TOKEN) return null;
    const response = await fetch(`https://${fly.registryHost}/v2/${app}/manifests/${tag}`, {
      method: "HEAD",
      headers: {
        "authorization": this.registryAuthHeader(),
        "accept": "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
    });
    await response.arrayBuffer();
    if (!response.ok) return null;
    return response.headers.get("docker-content-digest");
  }

  async deleteImageManifest(app: string, digest: string): Promise<void> {
    const { fly } = getConfig();
    if (this.token === MOCK_FLY_TOKEN) return; // no mock registry — see resolveImageDigest
    const response = await fetch(`https://${fly.registryHost}/v2/${app}/manifests/${digest}`, {
      method: "DELETE",
      headers: { "authorization": this.registryAuthHeader() },
    });
    await response.arrayBuffer();
    // 404 = already gone; anything else non-2xx is unexpected but GC is best-effort.
  }
}

export function flyClientForNamespaceOrg(org: { orgSlug: string, token: string }): FlyClient {
  return new FlyClient(org.token, org.orgSlug);
}
