import { createTar } from "@hexclave/shared/dist/utils/tar";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

// These tests run against the local Marshal dev server (apps/marshal), which
// itself talks to the fly-mock docker service (docker/dependencies/fly-mock)
// and the s3mock bucket — the backend's .env.development points at Marshal via
// the mock HEXCLAVE_MARSHAL_API_KEY, and Marshal's .env.development enables
// the mock builder (instant fake digests). CI never talks to real Fly.
// Secret values are KMS-encrypted server-side via the localstack container.
const FLY_MOCK_URL = `http://localhost:${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81"}48`;

// Service ids are randomized per test because the fly-mock accumulates apps
// for its whole container lifetime: metadata-based lookups (see findMockApp)
// must not collide with earlier runs or concurrently-running tests.
function uniqueServiceId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function makeSourceTarball(files: Record<string, string> = { "Dockerfile": "FROM nginx:alpine\n", "index.html": "<h1>hello</h1>" }): Uint8Array {
  return gzipSync(createTar(Object.entries(files).map(([path, content]) => ({
    path,
    data: new TextEncoder().encode(content),
  }))));
}

async function createUpload(files?: Record<string, string>): Promise<{ uploadId: string }> {
  const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", {
    method: "POST",
    accessType: "admin",
  });
  if (uploadResponse.status !== 201) throw new Error(`Failed to create upload: ${JSON.stringify(uploadResponse.body)}`);
  const uploadUrl = (uploadResponse.body as any).upload_url;
  const contentType = (uploadResponse.body as any).content_type;
  if (typeof uploadUrl !== "string" || typeof contentType !== "string") {
    throw new Error(`Upload response is missing the upload URL or content type: ${JSON.stringify(uploadResponse.body)}`);
  }
  const source = makeSourceTarball(files);
  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": source.length.toString(),
    },
    body: new Uint8Array(source).slice().buffer,
  });
  if (!putResponse.ok) throw new Error(`Failed to upload tarball: ${putResponse.status} ${await putResponse.text()}`);
  return { uploadId: (uploadResponse.body as any).id };
}

// Syncs service definitions the way `hexclave deploy` does (its first step
// after evaluating the config file's `services` export).
async function syncServices(services: Record<string, unknown>): Promise<string> {
  const response = await niceBackendFetch("/api/v1/deployments/services", {
    method: "PUT",
    accessType: "admin",
    body: { services },
  });
  if (response.status !== 200) throw new Error(`Failed to sync services: ${JSON.stringify(response.body)}`);
  const syncId = (response.body as any).sync_id;
  if (typeof syncId !== "string") throw new Error(`Sync response is missing sync_id: ${JSON.stringify(response.body)}`);
  return syncId;
}

async function syncServiceAndUpload(serviceId: string, definition: Record<string, unknown> = {}, files?: Record<string, string>): Promise<{ uploadId: string, definitionSyncId: string }> {
  const definitionSyncId = await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: {}, ...definition } });
  return { ...await createUpload(files), definitionSyncId };
}

async function startDeploy(serviceId: string, uploadId: string, definitionSyncId: string, extraBody: Record<string, unknown> = {}, accessType: "admin" | "server" = "admin"): Promise<string> {
  const deployResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
    method: "POST",
    accessType,
    body: { upload_id: uploadId, definition_sync_id: definitionSyncId, ...extraBody },
  });
  if (deployResponse.status !== 200) throw new Error(`Failed to start deploy: ${JSON.stringify(deployResponse.body)}`);
  return (deployResponse.body as any).run_id;
}

// The mock builder completes asynchronously (next tick + machine rollout
// against the fly-mock), so poll the run until it settles. The wall-clock budget matches the
// declared test timeout so a slow CI runner doesn't fail early with 100s of the timeout unused;
// the give-up error includes the last observed body for debuggability.
async function pollRunToStatus(runId: string, wantedStatus: "ready" | "error"): Promise<Record<string, any>> {
  let last: any = null;
  for (let attempt = 0; attempt < 240; attempt++) {
    const poll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    last = poll;
    const body = poll.body as any;
    if (body?.status === wantedStatus) return body;
    if (body?.status === "ready" || body?.status === "error" || body?.status === "canceled") {
      throw new Error(`Run reached ${body.status} instead of ${wantedStatus}: ${JSON.stringify(body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Run ${runId} did not become ${wantedStatus} in time; last poll: ${last?.status} ${JSON.stringify(last?.body)}`);
}

type MockApp = {
  name: string,
  sharedIpv4: string | null,
  dedicatedIps: { id: string, address: string, type: string }[],
  machines: { id: string, image: string, metadata: Record<string, string>, env: Record<string, string>, mounts: { volume: string, path: string }[] }[],
  volumes: { id: string, name: string, size_gb: number, attached_machine_id: string | null }[],
  certificates: { hostname: string, clientStatus: string }[],
};

// Finds the fly-mock app backing a service by the hexclave_key metadata its machines carry
// (the test doesn't need Marshal's app-naming scheme), and waits for the expected machine
// count as an independent assertion on the runtime fleet. Matches on ns too so a fixed-id
// service in a parallel worker can't shadow it.
async function findMockApp(serviceId: string, expectedMachines = 1, ns?: string): Promise<MockApp> {
  let seen: MockApp | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${FLY_MOCK_URL}/__mock/apps`);
    if (response.ok) {
      const { apps } = await response.json() as { apps: MockApp[] };
      const matches = apps.filter((candidate) => candidate.machines.some((machine) =>
        machine.metadata.hexclave_key === serviceId && (ns === undefined || machine.metadata.hexclave_ns === ns)));
      if (matches.length > 0) {
        seen = matches[0];
        if (seen.machines.length >= expectedMachines) return seen;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`fly-mock app for ${serviceId} never converged to ${expectedMachines} machine(s) (last saw ${seen?.machines.length ?? 0})`);
}

describe("access control", () => {
  it("rejects client access to deployment endpoints", async ({ expect }) => {
    await Project.createAndSwitch();
    const response = await niceBackendFetch("/api/v1/deployments/services", { accessType: "client" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": [
              "server",
              "admin",
            ],
          },
          "error": "The x-hexclave-access-type header must be 'server' or 'admin', but was 'client'. (The legacy x-stack-access-type header is also accepted.)",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
    const secretsResponse = await niceBackendFetch("/api/v1/project-secrets", { accessType: "client" });
    expect(secretsResponse.status).toBe(401);
  });

  it("accepts secret-server-key access for the whole CI deploy sequence", async ({ expect }) => {
    await Project.createAndSwitch();
    await InternalApiKey.createAndSetProjectKeys();
    // Every route the CLI hits in a server-key-only environment (CI) must
    // accept server access, not just admin: list, sync, secrets pre-flight,
    // and upload creation. (The deploy POST itself is covered with
    // accessType: "server" in the end-to-end test below.)
    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "server" });
    expect(listResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "items": [] },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const syncResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "server",
      body: { services: { web: { type: "serverless", ports: [{ port: 3000 }], env: {} } } },
    });
    expect(syncResponse.status).toBe(200);
    const secretsResponse = await niceBackendFetch("/api/v1/project-secrets", { accessType: "server" });
    expect(secretsResponse.status).toBe(200);
    const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "server" });
    expect(uploadResponse.status).toBe(201);
  });
});

describe("definition sync", () => {
  it("syncs, lists, and reads container service definitions", async ({ expect }) => {
    await Project.createAndSwitch();

    await syncServices({
      api: {
        type: "serverless",
        ports: [{ port: 8080 }],
        // min_instances stays 0: this project's billing team is on the Free
        // plan, where always-on instances are rejected by the sync route.
        min_instances: 0,
        max_instances: 3,
        root_directory: "api",
        env: {
          MY_ENV_VAR: { value: "true" },
          DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
          NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        },
      },
    });

    const getResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect(getResponse.status).toBe(200);
    const body = getResponse.body as any;
    expect(body).toMatchObject({
      id: "api",
      type: "serverless",
      // Defaults filled in: a bare `{ port }` is a private HTTP port.
      ports: [{ port: 8080, public: false, transport: "http" }],
      min_instances: 0,
      max_instances: 3,
      root_directory: "api",
      provisioned: false,
      status: "not_deployed",
      has_successful_deploy: false,
      url: null,
      domains: [],
      latest_run: null,
    });
    expect(body.env).toEqual([
      { key: "DATABASE_CONNECTION_STRING", type: "secret", value: null, secret_key: "db_connection" },
      { key: "MY_ENV_VAR", type: "plain", value: "true", secret_key: null },
      { key: "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", type: "connection", value: "hexclave.projectId", secret_key: null },
    ]);

    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items.map((item: any) => item.id)).toEqual(["api"]);
  });

  it("stores a mixed port list and rejects the ones it could not serve", async ({ expect }) => {
    await Project.createAndSwitch();

    await syncServices({
      database: { type: "serverless", ports: [{ port: 5432, transport: "tcp" }], env: {} },
      // Several PRIVATE ports of mixed protocols.
      gateway: {
        type: "server",
        ports: [{ port: 3000 }, { port: 9090 }, { port: 5433, transport: "tcp" }],
        env: {},
      },
    });
    const database = await niceBackendFetch("/api/v1/deployments/services/database", { accessType: "admin" });
    expect(database.status).toBe(200);
    expect(database.body).toMatchObject({ ports: [{ port: 5432, public: false, transport: "tcp" }] });
    const gateway = await niceBackendFetch("/api/v1/deployments/services/gateway", { accessType: "admin" });
    expect((gateway.body as any).ports).toEqual([
      { port: 3000, public: false, transport: "http" },
      { port: 9090, public: false, transport: "http" },
      { port: 5433, public: false, transport: "tcp" },
    ]);

    const rejects = async (ports: unknown, expectedMessage: string) => {
      const response = await niceBackendFetch("/api/v1/deployments/services", {
        method: "PUT",
        accessType: "admin",
        body: { services: { svc: { type: "serverless", ports, env: {} } } },
      });
      expect(response.status, `ports ${JSON.stringify(ports)}`).toBe(400);
      expect(JSON.stringify(response.body)).toContain(expectedMessage);
    };
    // Raw TCP has no TLS termination or HTTP routing to be public with.
    await rejects([{ port: 5432, transport: "tcp", public: true }], "private-only");
    // 80/443 reach one port, so a second public one has nowhere to be served.
    await rejects([{ port: 3000, public: true }, { port: 4000, public: true }], "at most one public port");
    // A public port may not have private siblings: the runtime serves a port on
    // every address the service has, so they would be public too.
    await rejects([{ port: 3000, public: true }, { port: 9090 }], "may not declare any other port");
    await rejects([], "at least one port");
    await rejects([{ port: 3000 }, { port: 3000 }], "once");
  });

  it("rejects always-on instances on the Free plan, naming the offending services", async ({ expect }) => {
    // A project created through the internal projects API is owned by a billing
    // team that starts on the Free plan (Project.create waits for that
    // entitlement), so this exercises the gate's POSITIVE path — unlike the
    // other tests here, whose projects have no owner team and are never gated.
    const { createProjectResponse } = await Project.createAndSwitch();
    expect(createProjectResponse.body.owner_team_id).toEqual(expect.any(String));

    // The gate deliberately respects the same HEXCLAVE_DISABLE_PLAN_LIMITS
    // switch as every other Hexclave plan limit, and local `.env.local` files
    // commonly set it. Read what the backend actually does rather than assuming
    // — otherwise this test silently means the opposite thing on a dev machine.
    const planUsage = await niceBackendFetch("/api/v1/internal/plan-usage", { accessType: "admin" });
    const enforced = (planUsage.body as any)?.are_plan_limits_enforced !== false;

    const response = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: {
        services: {
          web: { type: "serverless", ports: [{ port: 3000 }], min_instances: 1, env: {} },
          worker: { type: "serverless", ports: [{ port: 3001 }], min_instances: 2, max_instances: 3, env: {} },
          idle: { type: "serverless", ports: [{ port: 3002 }], env: {} },
        },
      },
    });

    if (!enforced) {
      // Plan limits off: the gate must fail OPEN, not half-apply.
      expect(response.status).toBe(200);
      return;
    }

    expect(response.status).toBe(400);
    const message = JSON.stringify(response.body);
    expect(message).toContain("Free plan");
    // Names every offending service, and only those. Matched with backticks
    // because the message's own prose contains the bare word "idle".
    expect(message).toContain("`web`");
    expect(message).toContain("`worker`");
    expect(message).not.toContain("`idle`");

    // Nothing was written: the gate runs before the upsert.
    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items).toEqual([]);

    // The same services scale-to-zero sync fine.
    const accepted = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: {
        services: {
          web: { type: "serverless", ports: [{ port: 3000 }], min_instances: 0, max_instances: 3, env: {} },
          worker: { type: "serverless", ports: [{ port: 3001 }], env: {} },
        },
      },
    });
    expect(accepted.status).toBe(200);
  });

  it("stores a volume and surfaces it on the service", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("vol");
    await syncServices({
      [serviceId]: { type: "server", ports: [{ port: 3000 }], min_instances: 0, max_instances: 1, persistent_volumes: { data: { path: "/data", size_gb: 10 } }, env: {} },
    });
    const getResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect(getResponse.status).toBe(200);
    // Keyed by volume id, the same shape the config file declares.
    expect((getResponse.body as any).persistent_volumes).toEqual({ data: { path: "/data", size_gb: 10 } });

    // Re-syncing without the volume must clear ALL THREE columns, not leave a
    // half-written tuple that would keep mounting a disk the config dropped.
    await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3000 }], min_instances: 0, max_instances: 1, env: {} } });
    const afterRemoval = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((afterRemoval.body as any).persistent_volumes).toBe(null);
  });

  it("rejects shrinking a volume at sync time, before anything is uploaded", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("shrink");
    const definition = (sizeGb: number) => ({
      [serviceId]: { type: "server", ports: [{ port: 3000 }], max_instances: 1, persistent_volumes: { data: { path: "/data", size_gb: sizeGb } }, env: {} },
    });
    await syncServices(definition(10));

    // Growing is fine; shrinking must fail HERE rather than at apply time, when
    // the CLI has already packaged and uploaded the source.
    await syncServices(definition(20));
    const shrunk = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT", accessType: "admin", body: { services: definition(5) },
    });
    expect(shrunk.status).toBe(400);
    expect(JSON.stringify(shrunk.body)).toContain("cannot be shrunk");

    // The rejected sync wrote nothing — the stored size is still the grown one.
    const read = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((read.body as any).persistent_volumes).toEqual({ data: { path: "/data", size_gb: 20 } });

    // Detaching entirely is always allowed, whatever the size.
    const detached = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT", accessType: "admin",
      body: { services: { [serviceId]: { type: "serverless", ports: [{ port: 3000 }], max_instances: 1, env: {} } } },
    });
    expect(detached.status).toBe(200);
  });

  it("rejects a volume on a service that could run more than one instance", async ({ expect }) => {
    await Project.createAndSwitch();
    // A Fly volume attaches to one machine, so a fleet would silently give each
    // instance its own separate disk. Only a "server" is single-instance by
    // construction, so that is where the rule lives now.
    const response = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "serverless", ports: [{ port: 3000 }], max_instances: 2, persistent_volumes: { data: { path: "/data", size_gb: 1 } }, env: {} } } },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("only a \\\"server\\\" service may have persistent volumes");

    // A server may not restate bounds that contradict its type.
    const badBounds = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "server", ports: [{ port: 3000 }], max_instances: 2, persistent_volumes: { data: { path: "/data", size_gb: 1 } }, env: {} } } },
    });
    expect(badBounds.status).toBe(400);

    // More than one disk on one machine is beyond what Fly can mount.
    const twoVolumes = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "server", ports: [{ port: 3000 }], env: {},
        persistent_volumes: { data: { path: "/data", size_gb: 1 }, cache: { path: "/cache", size_gb: 1 } } } } },
    });
    expect(twoVolumes.status).toBe(400);
    expect(JSON.stringify(twoVolumes.body)).toContain("at most 1 persistent volume");
  });

  it("rejects a volume mount path that is not a normalized absolute path", async ({ expect }) => {
    await Project.createAndSwitch();
    for (const path of ["data", "/", "/data/../etc"]) {
      const response = await niceBackendFetch("/api/v1/deployments/services", {
        method: "PUT",
        accessType: "admin",
        body: { services: { web: { type: "server", ports: [{ port: 3000 }], persistent_volumes: { data: { path, size_gb: 1 } }, env: {} } } },
      });
      expect(response.status, `path ${JSON.stringify(path)}`).toBe(400);
      expect(JSON.stringify(response.body)).toContain("normalized absolute path");
    }
  });

  it("stores dockerfile_path and rejects one escaping the source root", async ({ expect }) => {
    await Project.createAndSwitch();
    const ok = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "serverless", ports: [{ port: 3000 }], dockerfile_path: "docker/Dockerfile.web", env: {} } } },
    });
    expect(ok.status).toBe(200);
    expect((ok.body as any).items.find((item: any) => item.id === "web").dockerfile_path).toBe("docker/Dockerfile.web");
    const escaping = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "serverless", ports: [{ port: 3000 }], dockerfile_path: "../Dockerfile", env: {} } } },
    });
    expect(escaping.status).toBe(400);
    expect(JSON.stringify(escaping.body)).toContain("dockerfile_path");
  });

  it("rejects definitions without a port and with a non-container type", async ({ expect }) => {
    await Project.createAndSwitch();
    const noPort = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "serverless", env: {} } } },
    });
    expect(noPort.status).toBe(400);
    const wrongType = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", ports: [{ port: 3000 }], env: {} } } },
    });
    expect(wrongType.status).toBe(400);
  });

  it("rejects the reserved `hexclave` service id and an empty services map", async ({ expect }) => {
    await Project.createAndSwitch();
    const reserved = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { hexclave: { type: "serverless", ports: [{ port: 3000 }], env: {} } } },
    });
    expect(reserved.status).toBe(400);
    const empty = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: {} },
    });
    // An empty services map is rejected — the CLI only syncs when the config declares at
    // least one service (evaluateServicesFunction errors on an empty export).
    expect(empty.status).toBe(400);
  });
});

describe("secrets", () => {
  it("sets, lists, overwrites, and deletes write-only secret values", async ({ expect }) => {
    await Project.createAndSwitch();

    const setResponse = await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "db_connection", value: "postgres://user:hunter2@db.example.com/app" },
    });
    expect(setResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created": true,
          "key": "db_connection",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Overwriting reports created: false; the value is never echoed anywhere.
    const overwriteResponse = await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "db_connection", value: "postgres://user:hunter3@db.example.com/app" },
    });
    expect((overwriteResponse.body as any).created).toBe(false);

    const listResponse = await niceBackendFetch("/api/v1/project-secrets", { accessType: "admin" });
    expect(listResponse.status).toBe(200);
    expect((listResponse.body as any).items.map((item: any) => item.key)).toEqual(["db_connection"]);
    expect(JSON.stringify(listResponse.body)).not.toContain("hunter");

    // Invalid keys and empty values are rejected.
    const invalidKeyResponse = await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "bad key", value: "x" },
    });
    expect(invalidKeyResponse.status).toBe(400);
    const emptyValueResponse = await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "some_key", value: "" },
    });
    expect(emptyValueResponse.status).toBe(400);

    const deleteResponse = await niceBackendFetch("/api/v1/project-secrets/db_connection", {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const deleteAgainResponse = await niceBackendFetch("/api/v1/project-secrets/db_connection", {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteAgainResponse.status).toBe(404);
    const emptyListResponse = await niceBackendFetch("/api/v1/project-secrets", { accessType: "admin" });
    expect((emptyListResponse.body as any).items).toEqual([]);
  });

  it("scopes secrets per project", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "shared_key", value: "project-a-value" },
    });
    await Project.createAndSwitch();
    const otherProjectList = await niceBackendFetch("/api/v1/project-secrets", { accessType: "admin" });
    expect((otherProjectList.body as any).items).toEqual([]);
  });
});

describe("deploys against the Marshal runtime", () => {
  it("deploys a service end to end: sync, upload, build, machines, env resolution", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    await InternalApiKey.createAndSetProjectKeys();
    const serviceId = uniqueServiceId("web");

    // Store a secret value first (the dashboard flow), then reference it.
    const setSecret = await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "openai_api_key", value: "sk-secret-value-123" },
    });
    expect(setSecret.status).toBe(200);

    const definitionSyncId = await syncServices({
      [serviceId]: {
        type: "serverless",
        ports: [{ port: 3000 }],
        min_instances: 0,
        max_instances: 2,
        // Rides through the whole deploy into the Marshal spec — this covers the
        // backend→Marshal dockerfile_path passthrough (Marshal validates it on the spec
        // PUT; the mock builder then ignores it, as builds are not exercised here).
        dockerfile_path: "docker/Dockerfile.web",
        env: {
          PLAIN_VAR: { value: "plain-value" },
          OPENAI_KEY: { type: "secret", key: "openai_api_key" },
          PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
          ["__proto__"]: { value: "special-key-value" },
        },
      },
    });
    const { uploadId } = await createUpload();
    const runId = await startDeploy(serviceId, uploadId, definitionSyncId, {}, "server");
    const run = await pollRunToStatus(runId, "ready");
    expect(run.service_id).toBe(serviceId);
    expect(run.target).toBe("production");
    expect(run.triggered_by).toBe("server");
    // Container services are private by default: no verified domain, no URL.
    expect(run.url).toBeNull();

    // The service board shape after a successful deploy.
    const serviceResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    const service = serviceResponse.body as any;
    expect(service.status).toBe("deployed");
    expect(service.provisioned).toBe(true);
    expect(service.has_successful_deploy).toBe(true);

    // The fly-mock shows the machines Marshal created: max_instances of them,
    // with the resolved env (secrets and hexclave connections resolved
    // server-side; nothing unresolved leaks through).
    const app = await findMockApp(serviceId, 2);
    expect(app.machines).toHaveLength(2);
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");
    for (const machine of app.machines) {
      expect(machine.env).toEqual({
        PLAIN_VAR: "plain-value",
        OPENAI_KEY: "sk-secret-value-123",
        PROJECT_ID: projectKeys.projectId,
        ["__proto__"]: "special-key-value",
      });
      expect(machine.image).toMatch(/^registry\.fly\.io\/.*@sha256:[0-9a-f]{64}$/);
      expect(machine.metadata.hexclave_key).toBe(serviceId);
    }

    // Build logs stream with the secret value redacted (stage-2 redaction). The mock builder
    // echoes the resolved env into the log (MARSHAL_MOCK_ENV), so this is a REAL redaction
    // check: the plain var survives verbatim, the secret's resolved value is scrubbed to
    // <redacted>, and the raw secret never appears.
    const logsResponse = await niceBackendFetch(`/api/v1/deployments/runs/${runId}/logs`, { accessType: "admin" });
    expect(logsResponse.status).toBe(200);
    const logsText = typeof logsResponse.body === "string" ? logsResponse.body : JSON.stringify(logsResponse.body);
    expect(logsText).toContain("MARSHAL_MOCK_ENV");
    expect(logsText).toContain("PLAIN_VAR=plain-value"); // non-secret value passes through
    expect(logsText).toContain("<redacted>"); // the secret was actually redacted, not just absent
    expect(logsText).not.toContain("sk-secret-value-123");
  });

  it("provisions a volume and mounts it on the machine", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("vol");
    // `server`, because only a single-instance service may hold a disk. Its
    // min_instances 0 is scale-to-zero by SUSPENDING, so the disk comes back
    // with the machine (and Free-plan projects can't pin instances anyway).
    const { uploadId, definitionSyncId } = await syncServiceAndUpload(serviceId, {
      type: "server",
      min_instances: 0,
      max_instances: 1,
      persistent_volumes: { data: { path: "/data", size_gb: 3 } },
    });
    await pollRunToStatus(await startDeploy(serviceId, uploadId, definitionSyncId), "ready");

    const app = await findMockApp(serviceId, 1);
    expect(app.volumes).toHaveLength(1);
    expect(app.volumes[0]).toMatchObject({ name: "hxv_data", size_gb: 3 });
    // The machine mounts that exact volume at the configured path.
    expect(app.machines[0].mounts).toEqual([{ volume: app.volumes[0].id, path: "/data" }]);
    expect(app.volumes[0].attached_machine_id).toBe(app.machines[0].id);

    // Growing the volume reuses the SAME volume rather than creating a second
    // one — the disk (and its data) must survive the redeploy.
    const grownSyncId = await syncServices({
      [serviceId]: { type: "server", ports: [{ port: 3000 }], min_instances: 0, max_instances: 1, persistent_volumes: { data: { path: "/data", size_gb: 5 } }, env: {} },
    });
    const { uploadId: grownUploadId } = await createUpload();
    await pollRunToStatus(await startDeploy(serviceId, grownUploadId, grownSyncId), "ready");

    const grownApp = await findMockApp(serviceId, 1);
    expect(grownApp.volumes).toHaveLength(1);
    expect(grownApp.volumes[0].id).toBe(app.volumes[0].id);
    expect(grownApp.volumes[0].size_gb).toBe(5);
  });

  it("adds a volume to an already-deployed service by recreating the machine", { timeout: 180_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("voladd");

    // Deploy WITHOUT a volume first. `server` from the start, so that the only
    // thing changing in the second sync is the volume itself — a type change
    // would force a recreate on its own and hide what this test is pinning.
    const first = await syncServiceAndUpload(serviceId, { type: "server", min_instances: 0, max_instances: 1 });
    await pollRunToStatus(await startDeploy(serviceId, first.uploadId, first.definitionSyncId), "ready");
    const before = await findMockApp(serviceId, 1);
    expect(before.volumes).toHaveLength(0);
    expect(before.machines[0].mounts).toEqual([]);
    const originalMachineId = before.machines[0].id;

    // Now add a volume. A machine's mounts cannot change in place — Fly places a
    // machine on its volume's host, and rejects an update that introduces a mount
    // on an already-placed machine (the mock reproduces that 400). So this must
    // provision the volume and RECREATE the machine, not update it. Before the
    // recreate path existed this deploy failed and every retry failed identically.
    const second = await syncServiceAndUpload(serviceId, {
      type: "server",
      min_instances: 0,
      max_instances: 1,
      persistent_volumes: { data: { path: "/data", size_gb: 2 } },
    });
    await pollRunToStatus(await startDeploy(serviceId, second.uploadId, second.definitionSyncId), "ready");

    const after = await findMockApp(serviceId, 1);
    expect(after.volumes).toHaveLength(1);
    expect(after.volumes[0]).toMatchObject({ name: "hxv_data", size_gb: 2 });
    expect(after.machines[0].mounts).toEqual([{ volume: after.volumes[0].id, path: "/data" }]);
    // A NEW machine, on the volume's host — not the original one updated in place.
    expect(after.machines[0].id).not.toBe(originalMachineId);
    expect(after.machines).toHaveLength(1);
  });

  it("marks the run failed and reports blocked when a `url` connection has no verified domain", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const apiServiceId = uniqueServiceId("api");
    const webServiceId = uniqueServiceId("web");
    // web references the API's PUBLIC url, which needs a verified domain the API doesn't have.
    const sync = await syncServices({
      [apiServiceId]: { type: "serverless", ports: [{ port: 8080 }], env: {} },
      [webServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: { API_URL: { type: "connection", value: `${apiServiceId}.url` } } },
    });
    const upload = await createUpload();
    const runId = await startDeploy(webServiceId, upload.uploadId, sync);
    const run = await pollRunToStatus(runId, "error");
    expect(JSON.stringify(run.error)).toContain("blocked");
    // The service reports blocked and has no public URL.
    const service = await niceBackendFetch(`/api/v1/deployments/services/${webServiceId}`, { accessType: "admin" });
    expect((service.body as any).url).toBeNull();
  });

  it("gives public services a fly.dev endpoint and removes ingress when they become private", { timeout: 180_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("public");

    const first = await syncServiceAndUpload(serviceId, { ports: [{ port: 3000, public: true }] });
    const publicRun = await pollRunToStatus(await startDeploy(serviceId, first.uploadId, first.definitionSyncId), "ready");
    expect(publicRun.url).toMatch(/^https:\/\/hxc-.+\.fly\.dev$/);
    const publicService = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((publicService.body as any).ports).toEqual([{ port: 3000, public: true, transport: "http" }]);
    expect((publicService.body as any).url).toBe(publicRun.url);
    const publicApp = await findMockApp(serviceId);
    expect(publicApp.sharedIpv4).not.toBeNull();
    expect(publicApp.dedicatedIps.some((ip) => ip.type === "v6")).toBe(true);

    const second = await syncServiceAndUpload(serviceId, { ports: [{ port: 3000, public: false }] });
    const privateRun = await pollRunToStatus(await startDeploy(serviceId, second.uploadId, second.definitionSyncId), "ready");
    expect(privateRun.url).toBeNull();
    const privateService = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((privateService.body as any).ports).toEqual([{ port: 3000, public: false, transport: "http" }]);
    expect((privateService.body as any).url).toBeNull();
    const privateApp = await findMockApp(serviceId);
    expect(privateApp.sharedIpv4).toBeNull();
    expect(privateApp.dedicatedIps.filter((ip) => ip.type === "v6")).toEqual([]);
  });

  it("rejects a connection to a service that doesn't exist", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("web");
    const syncId = await syncServices({
      [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: { X: { type: "connection", value: "nonexistent.internalUrl" } } },
    });
    const { uploadId } = await createUpload();
    const response = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: syncId },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("doesn't exist");
  });

  it("resolves internalUrl connections between services deterministically, named or not", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const apiServiceId = uniqueServiceId("api");
    const webServiceId = uniqueServiceId("web");

    // The API deploys first...
    const sync1 = await syncServices({
      [apiServiceId]: { type: "serverless", ports: [{ port: 8080 }], env: {} },
      [webServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: { API_URL: { type: "connection", value: `${apiServiceId}.internalUrl` } } },
    });
    const upload1 = await createUpload();
    await pollRunToStatus(await startDeploy(apiServiceId, upload1.uploadId, sync1), "ready");

    // ...and the web service's env gets the API's flycast address, which is
    // deterministic (it doesn't even require the API to be deployed).
    const upload2 = await createUpload();
    await pollRunToStatus(await startDeploy(webServiceId, upload2.uploadId, sync1), "ready");

    const webApp = await findMockApp(webServiceId);
    const apiApp = await findMockApp(apiServiceId);
    // The URL carries the PORT. Every port answers on its own number on the
    // private network — which is what lets a service expose more than one — so
    // there is no single well-known port to leave implicit.
    expect(webApp.machines[0].env.API_URL).toBe(`http://${apiApp.name}.flycast:8080`);

    // A multi-port target has to be named explicitly: a bare internalUrl() is
    // ambiguous and rejected, while `:9090` resolves to that port.
    const multiServiceId = uniqueServiceId("multi");
    const consumerId = uniqueServiceId("consumer");
    const ambiguous = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: {
        services: {
          [multiServiceId]: { type: "serverless", ports: [{ port: 8080 }, { port: 9090 }], env: {} },
          [consumerId]: { type: "serverless", ports: [{ port: 3000 }], env: { API: { type: "connection", value: `${multiServiceId}.internalUrl` } } },
        },
      },
    });
    expect(ambiguous.status).toBe(200);
    const consumerUpload = await createUpload();
    const ambiguousDeploy = await niceBackendFetch(`/api/v1/deployments/services/${consumerId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: consumerUpload.uploadId, definition_sync_id: (ambiguous.body as any).sync_id },
    });
    expect(ambiguousDeploy.status).toBe(400);
    expect(JSON.stringify(ambiguousDeploy.body)).toContain("exactly one HTTP port");

    const namedSync = await syncServices({
      [multiServiceId]: { type: "serverless", ports: [{ port: 8080 }, { port: 9090 }], env: {} },
      [consumerId]: { type: "serverless", ports: [{ port: 3000 }], env: { API: { type: "connection", value: `${multiServiceId}.internalUrl:9090` } } },
    });
    const namedUpload = await createUpload();
    // Note the target is never deployed: naming the port makes the URL fully
    // determined, so it resolves on deploy ORDER alone, like internalHost.
    await pollRunToStatus(await startDeploy(consumerId, namedUpload.uploadId, namedSync), "ready");
    const consumerApp = await findMockApp(consumerId);
    expect(consumerApp.machines[0].env.API).toMatch(/^http:\/\/hxc-.+\.flycast:9090$/);
    // The API must report the reference it actually stored, port and all —
    // reporting a bare `internalUrl` would name a DIFFERENT (and, on this
    // multi-port target, invalid) config.
    const consumerService = await niceBackendFetch(`/api/v1/deployments/services/${consumerId}`, { accessType: "admin" });
    expect((consumerService.body as any).env).toContainEqual(
      { key: "API", type: "connection", value: `${multiServiceId}.internalUrl:9090`, secret_key: null },
    );
    // A port suffix is meaningful only on internalUrl.
    const strayPort = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { [consumerId]: { type: "serverless", ports: [{ port: 3000 }], env: { H: { type: "connection", value: `${multiServiceId}.internalHost:9090` } } } } },
    });
    expect(strayPort.status).toBe(200);
    const strayUpload = await createUpload();
    const strayDeploy = await niceBackendFetch(`/api/v1/deployments/services/${consumerId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: strayUpload.uploadId, definition_sync_id: (strayPort.body as any).sync_id },
    });
    expect(strayDeploy.status).toBe(400);
    // Quote-free substring: the body is JSON-stringified, so the message's own quotes are escaped.
    expect(JSON.stringify(strayDeploy.body)).toContain("names a port, but only");
  });

  it("fails the run when the container build fails", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("failing");
    const { uploadId, definitionSyncId } = await syncServiceAndUpload(serviceId, {
      // The magic env key makes Marshal's mock builder fail the build.
      env: { MARSHAL_MOCK_FAIL_BUILD: { value: "1" } },
    });
    const runId = await startDeploy(serviceId, uploadId, definitionSyncId);
    const run = await pollRunToStatus(runId, "error");
    expect(run.error).toContain("mock build failed");
  });

  it("does not consume the upload when secrets are missing, and lists every missing key", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("needs-secret");
    const definitionSyncId = await syncServices({
      [serviceId]: {
        type: "serverless",
        ports: [{ port: 3000 }],
        env: {
          REQUIRED: { type: "secret", key: "never_set_secret" },
          ALSO_REQUIRED: { type: "secret", key: "also_never_set" },
        },
      },
    });
    const { uploadId } = await createUpload();
    const failedDeploy = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: definitionSyncId },
    });
    expect(failedDeploy.status).toBe(400);
    // Both missing keys are named in one error (not just the first).
    expect(JSON.stringify(failedDeploy.body)).toContain("never_set_secret");
    expect(JSON.stringify(failedDeploy.body)).toContain("also_never_set");

    // The upload survives the rejected deploy: set both secrets and reuse it.
    for (const key of ["never_set_secret", "also_never_set"]) {
      await niceBackendFetch("/api/v1/project-secrets", { method: "POST", accessType: "admin", body: { key, value: "now-set" } });
    }
    const runId = await startDeploy(serviceId, uploadId, definitionSyncId);
    await pollRunToStatus(runId, "ready");
  });

  it("404s a deploy referencing an upload id that doesn't exist", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("web");
    const definitionSyncId = await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} } });
    const response = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: randomUUID(), definition_sync_id: definitionSyncId },
    });
    expect(response.status).toBe(404);
  });

  it("consumes an upload exactly once", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("once");
    const { uploadId, definitionSyncId } = await syncServiceAndUpload(serviceId);
    await pollRunToStatus(await startDeploy(serviceId, uploadId, definitionSyncId), "ready");
    const secondDeploy = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: definitionSyncId },
    });
    expect(secondDeploy.status).toBe(404);
  });

  it("rejects deploys with a stale definition sync id", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("stale");
    const { uploadId, definitionSyncId } = await syncServiceAndUpload(serviceId);
    // A second sync regenerates the fencing token...
    await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3001 }], env: {} } });
    // ...so the first deploy's token is now stale.
    const response = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: definitionSyncId },
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain("changed after this deploy synced its definitions");
  });

  it("404s deploys of services that were never synced", async ({ expect }) => {
    await Project.createAndSwitch();
    const { uploadId } = await createUpload();
    const response = await niceBackendFetch(`/api/v1/deployments/services/never-synced/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: randomUUID() },
    });
    expect(response.status).toBe(404);
  });

  it("keeps the machine env in sync when a redeploy drops a var", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("recon");
    const sync1 = await syncServices({
      [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: { KEEP: { value: "yes" }, DROP: { value: "bye" } } },
    });
    const upload1 = await createUpload();
    await pollRunToStatus(await startDeploy(serviceId, upload1.uploadId, sync1), "ready");
    expect((await findMockApp(serviceId)).machines[0].env).toEqual({ KEEP: "yes", DROP: "bye" });

    const sync2 = await syncServices({
      [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: { KEEP: { value: "yes" } } },
    });
    const upload2 = await createUpload();
    await pollRunToStatus(await startDeploy(serviceId, upload2.uploadId, sync2), "ready");
    // The machines were fully replaced with the new spec's env — the dropped
    // var is actually gone, not merely unlisted.
    expect((await findMockApp(serviceId)).machines[0].env).toEqual({ KEEP: "yes" });
  });

  // Skipped: Marshal serializes concurrent applies with a lease built on conditional writes
  // (If-None-Match), and the s3mock container this suite runs against does not honour them
  // atomically — two callers both "acquire" the lease, so the serialization this asserts
  // cannot hold here. Real S3/R2 does honour them, and the losing deploy now returns a clean
  // 409 rather than a 500. Un-skip once the e2e object store enforces conditional writes.
  it.skip("serializes concurrent deploys so a stale completion cannot overwrite the winner", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("concurrent");
    const definitionSyncId = await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} } });
    const [firstUpload, secondUpload] = await Promise.all([createUpload(), createUpload()]);
    const [firstRunId, secondRunId] = await Promise.all([
      startDeploy(serviceId, firstUpload.uploadId, definitionSyncId),
      startDeploy(serviceId, secondUpload.uploadId, definitionSyncId),
    ]);

    const terminalStatuses = new Map<string, string>();
    for (let attempt = 0; attempt < 240 && terminalStatuses.size < 2; attempt++) {
      for (const runId of [firstRunId, secondRunId]) {
        if (terminalStatuses.has(runId)) continue;
        const response = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
        const status = (response.body as any)?.status;
        if (status === "ready" || status === "error" || status === "canceled") terminalStatuses.set(runId, status);
      }
      if (terminalStatuses.size < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect([...terminalStatuses.values()].sort()).toEqual(["canceled", "ready"]);
  });

  // NOTE: there is deliberately no backend DELETE-service route (removal is config-driven;
  // auto-cleanup of services dropped from the config is a tracked gap), so Marshal's
  // deleteService — which releases the hostname claim and tears down the Fly app — has no
  // backend-e2e path to exercise. Worth a direct Marshal-level test when one is added.
});

describe("domains", () => {
  it("adds a domain, reports its DNS records, and removes it", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("domained");
    const { uploadId, definitionSyncId } = await syncServiceAndUpload(serviceId);
    await pollRunToStatus(await startDeploy(serviceId, uploadId, definitionSyncId), "ready");

    // The magic ".verified.test" suffix makes the fly-mock verify instantly.
    const hostname = `${serviceId}.verified.test`;
    const addResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname, is_primary: true },
    });
    expect(addResponse.status).toBe(201);
    expect((addResponse.body as any).verified).toBe(true);

    const getResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains/${hostname}`, { accessType: "admin" });
    expect(getResponse.status).toBe(200);
    expect((getResponse.body as any).verified).toBe(true);
    expect((getResponse.body as any).pending_first_deploy).toBe(false);

    // A verified primary domain becomes the service's public URL...
    const serviceResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((serviceResponse.body as any).url).toBe(`https://${hostname}`);

    // ...and an unverified one reports the records to create.
    const pendingHostname = `${serviceId}.example.com`;
    const addPending = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname: pendingHostname },
    });
    expect(addPending.status).toBe(201);
    expect((addPending.body as any).verified).toBe(false);
    const getPending = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains/${pendingHostname}`, { accessType: "admin" });
    const records = (getPending.body as any).dns_records;
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);

    const deleteResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains/${hostname}`, {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteResponse.status).toBe(200);
    const serviceAfterDelete = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}`, { accessType: "admin" });
    expect((serviceAfterDelete.body as any).url).toBeNull();
  });

  it("rejects a hostname already attached to another project's service", { timeout: 120_000 }, async ({ expect }) => {
    // The hostname registry is global across namespaces (Fly itself does NOT
    // enforce cross-app hostname uniqueness — Marshal's bucket registry does).
    const hostname = `contested-${randomUUID().slice(0, 8)}.verified.test`;

    await Project.createAndSwitch();
    const firstServiceId = uniqueServiceId("first");
    const first = await syncServiceAndUpload(firstServiceId);
    await pollRunToStatus(await startDeploy(firstServiceId, first.uploadId, first.definitionSyncId), "ready");
    const firstAdd = await niceBackendFetch(`/api/v1/deployments/services/${firstServiceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname },
    });
    expect(firstAdd.status).toBe(201);

    await Project.createAndSwitch();
    const secondServiceId = uniqueServiceId("second");
    const second = await syncServiceAndUpload(secondServiceId);
    await pollRunToStatus(await startDeploy(secondServiceId, second.uploadId, second.definitionSyncId), "ready");
    const secondAdd = await niceBackendFetch(`/api/v1/deployments/services/${secondServiceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname },
    });
    expect(secondAdd.status).toBe(409);
    expect(JSON.stringify(secondAdd.body)).toContain("already attached elsewhere");
  });

  it("rejects a hostname already attached to another service in the SAME project", { timeout: 120_000 }, async ({ expect }) => {
    // Marshal holds exactly one claim per hostname, so two services in one project must not
    // both keep a row for it: the loser would go on advertising a verified URL that routes to
    // the winner, and either service's delete would tear down the other's live certificate.
    await Project.createAndSwitch();
    const ownerServiceId = uniqueServiceId("owner");
    const otherServiceId = uniqueServiceId("other");
    const definitionSyncId = await syncServices({
      [ownerServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} },
      [otherServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} },
    });
    const ownerUpload = await createUpload();
    await pollRunToStatus(await startDeploy(ownerServiceId, ownerUpload.uploadId, definitionSyncId), "ready");
    const otherUpload = await createUpload();
    await pollRunToStatus(await startDeploy(otherServiceId, otherUpload.uploadId, definitionSyncId), "ready");

    const hostname = `${ownerServiceId}.verified.test`;
    const ownerAdd = await niceBackendFetch(`/api/v1/deployments/services/${ownerServiceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname, is_primary: true },
    });
    expect(ownerAdd.status).toBe(201);

    const otherAdd = await niceBackendFetch(`/api/v1/deployments/services/${otherServiceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname },
    });
    expect(otherAdd.status).toBe(400);
    expect(JSON.stringify(otherAdd.body)).toContain("already added to another service");

    // Reading the domain is a pure read on the runtime, so the owner still holds the
    // certificate afterwards and its public URL is unchanged.
    const ownerGet = await niceBackendFetch(`/api/v1/deployments/services/${ownerServiceId}/domains/${hostname}`, { accessType: "admin" });
    expect(ownerGet.status).toBe(200);
    expect((ownerGet.body as any).verified).toBe(true);
    const ownerService = await niceBackendFetch(`/api/v1/deployments/services/${ownerServiceId}`, { accessType: "admin" });
    expect((ownerService.body as any).url).toBe(`https://${hostname}`);
    const otherService = await niceBackendFetch(`/api/v1/deployments/services/${otherServiceId}`, { accessType: "admin" });
    expect((otherService.body as any).url).toBeNull();
  });

  it("uses the database reservation as the arbiter for concurrent same-project domain adds", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const firstServiceId = uniqueServiceId("race-a");
    const secondServiceId = uniqueServiceId("race-b");
    const definitionSyncId = await syncServices({
      [firstServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} },
      [secondServiceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} },
    });
    const [firstUpload, secondUpload] = await Promise.all([createUpload(), createUpload()]);
    const [firstRunId, secondRunId] = await Promise.all([
      startDeploy(firstServiceId, firstUpload.uploadId, definitionSyncId),
      startDeploy(secondServiceId, secondUpload.uploadId, definitionSyncId),
    ]);
    await Promise.all([pollRunToStatus(firstRunId, "ready"), pollRunToStatus(secondRunId, "ready")]);

    const hostname = `race-${randomUUID().slice(0, 8)}.verified.test`;
    const [firstAdd, secondAdd] = await Promise.all([
      niceBackendFetch(`/api/v1/deployments/services/${firstServiceId}/domains`, {
        method: "POST", accessType: "admin", body: { hostname },
      }),
      niceBackendFetch(`/api/v1/deployments/services/${secondServiceId}/domains`, {
        method: "POST", accessType: "admin", body: { hostname },
      }),
    ]);
    expect([firstAdd.status, secondAdd.status].sort((first, second) => first - second)).toEqual([201, 400]);

    const winner = firstAdd.status === 201 ? firstServiceId : secondServiceId;
    const loser = winner === firstServiceId ? secondServiceId : firstServiceId;
    const winnerService = await niceBackendFetch(`/api/v1/deployments/services/${winner}`, { accessType: "admin" });
    const loserService = await niceBackendFetch(`/api/v1/deployments/services/${loser}`, { accessType: "admin" });
    expect((winnerService.body as any).url).toBe(`https://${hostname}`);
    expect((loserService.body as any).url).toBeNull();
  });

  it("keeps domains as rows before the first deploy", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("undeployed");
    await syncServices({ [serviceId]: { type: "serverless", ports: [{ port: 3000 }], env: {} } });
    const addResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains`, {
      method: "POST",
      accessType: "admin",
      body: { hostname: `${serviceId}.verified.test` },
    });
    expect(addResponse.status).toBe(201);
    expect((addResponse.body as any).verified).toBe(false);
    const getResponse = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/domains/${serviceId}.verified.test`, { accessType: "admin" });
    expect((getResponse.body as any).pending_first_deploy).toBe(true);
  });
});
