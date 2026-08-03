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
  const definitionSyncId = await syncServices({ [serviceId]: { type: "container", port: 3000, env: {}, ...definition } });
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
// against the fly-mock), so poll the run until it settles.
async function pollRunToStatus(runId: string, wantedStatus: "ready" | "error"): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const poll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    const body = poll.body as any;
    if (body.status === wantedStatus) return body;
    if (body.status === "ready" || body.status === "error" || body.status === "canceled") {
      throw new Error(`Run reached ${body.status} instead of ${wantedStatus}: ${JSON.stringify(body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Run did not become ${wantedStatus} in time`);
}

type MockApp = {
  name: string,
  machines: { id: string, image: string, metadata: Record<string, string>, env: Record<string, string> }[],
  certificates: { hostname: string, clientStatus: string }[],
};

// Finds the fly-mock app backing a service by the hexclave_key metadata its
// machines carry — the test doesn't need to know Marshal's app-naming scheme.
async function findMockApp(serviceId: string): Promise<MockApp> {
  const response = await fetch(`${FLY_MOCK_URL}/__mock/apps`);
  if (!response.ok) throw new Error(`fly-mock /__mock/apps returned ${response.status}`);
  const { apps } = await response.json() as { apps: MockApp[] };
  const app = apps.find((candidate) => candidate.machines.some((machine) => machine.metadata.hexclave_key === serviceId));
  if (app === undefined) throw new Error(`No fly-mock app found for service ${serviceId}`);
  return app;
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
      body: { services: { web: { type: "container", port: 3000, env: {} } } },
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
        type: "container",
        port: 8080,
        min_instances: 1,
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
      type: "container",
      port: 8080,
      min_instances: 1,
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

  it("rejects definitions with legacy Vercel-era build fields", async ({ expect }) => {
    await Project.createAndSwitch();
    const response = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "container", port: 3000, framework: "nextjs", env: {} } } },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("no longer support `framework`");
  });

  it("rejects definitions without a port and with a non-container type", async ({ expect }) => {
    await Project.createAndSwitch();
    const noPort = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "container", env: {} } } },
    });
    expect(noPort.status).toBe(400);
    const wrongType = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", port: 3000, env: {} } } },
    });
    expect(wrongType.status).toBe(400);
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
        type: "container",
        port: 3000,
        min_instances: 0,
        max_instances: 2,
        env: {
          PLAIN_VAR: { value: "plain-value" },
          OPENAI_KEY: { type: "secret", key: "openai_api_key" },
          PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
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
    const app = await findMockApp(serviceId);
    expect(app.machines).toHaveLength(2);
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");
    for (const machine of app.machines) {
      expect(machine.env).toEqual({
        PLAIN_VAR: "plain-value",
        OPENAI_KEY: "sk-secret-value-123",
        PROJECT_ID: projectKeys.projectId,
      });
      expect(machine.image).toMatch(/^registry\.fly\.io\/.*@sha256:[0-9a-f]{64}$/);
      expect(machine.metadata.hexclave_key).toBe(serviceId);
    }

    // Build logs stream with the secret value redacted (stage-2 redaction).
    const logsResponse = await niceBackendFetch(`/api/v1/deployments/runs/${runId}/logs`, { accessType: "admin" });
    expect(logsResponse.status).toBe(200);
    const logsText = typeof logsResponse.body === "string" ? logsResponse.body : JSON.stringify(logsResponse.body);
    expect(logsText).toContain("MARSHAL_BUILD_START");
    expect(logsText).not.toContain("sk-secret-value-123");
  });

  it("resolves internalUrl connections between services deterministically", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const apiServiceId = uniqueServiceId("api");
    const webServiceId = uniqueServiceId("web");

    // The API deploys first...
    const sync1 = await syncServices({
      [apiServiceId]: { type: "container", port: 8080, env: {} },
      [webServiceId]: { type: "container", port: 3000, env: { API_URL: { type: "connection", value: `${apiServiceId}.internalUrl` } } },
    });
    const upload1 = await createUpload();
    await pollRunToStatus(await startDeploy(apiServiceId, upload1.uploadId, sync1), "ready");

    // ...and the web service's env gets the API's flycast address, which is
    // deterministic (it doesn't even require the API to be deployed).
    const upload2 = await createUpload();
    await pollRunToStatus(await startDeploy(webServiceId, upload2.uploadId, sync1), "ready");

    const webApp = await findMockApp(webServiceId);
    const apiApp = await findMockApp(apiServiceId);
    expect(webApp.machines[0].env.API_URL).toBe(`http://${apiApp.name}.flycast`);
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

  it("does not consume the upload when secrets are missing", { timeout: 120_000 }, async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("needs-secret");
    const definitionSyncId = await syncServices({
      [serviceId]: {
        type: "container",
        port: 3000,
        env: { REQUIRED: { type: "secret", key: "never_set_secret" } },
      },
    });
    const { uploadId } = await createUpload();
    const failedDeploy = await niceBackendFetch(`/api/v1/deployments/services/${serviceId}/deploy`, {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, definition_sync_id: definitionSyncId },
    });
    expect(failedDeploy.status).toBe(400);
    expect(JSON.stringify(failedDeploy.body)).toContain("never_set_secret");

    // The upload survives the rejected deploy: set the secret and reuse it.
    await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "never_set_secret", value: "now-set" },
    });
    const runId = await startDeploy(serviceId, uploadId, definitionSyncId);
    await pollRunToStatus(runId, "ready");
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
    await syncServices({ [serviceId]: { type: "container", port: 3001, env: {} } });
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
      [serviceId]: { type: "container", port: 3000, env: { KEEP: { value: "yes" }, DROP: { value: "bye" } } },
    });
    const upload1 = await createUpload();
    await pollRunToStatus(await startDeploy(serviceId, upload1.uploadId, sync1), "ready");
    expect((await findMockApp(serviceId)).machines[0].env).toEqual({ KEEP: "yes", DROP: "bye" });

    const sync2 = await syncServices({
      [serviceId]: { type: "container", port: 3000, env: { KEEP: { value: "yes" } } },
    });
    const upload2 = await createUpload();
    await pollRunToStatus(await startDeploy(serviceId, upload2.uploadId, sync2), "ready");
    // The machines were fully replaced with the new spec's env — the dropped
    // var is actually gone, not merely unlisted.
    expect((await findMockApp(serviceId)).machines[0].env).toEqual({ KEEP: "yes" });
  });
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

  it("keeps domains as rows before the first deploy", async ({ expect }) => {
    await Project.createAndSwitch();
    const serviceId = uniqueServiceId("undeployed");
    await syncServices({ [serviceId]: { type: "container", port: 3000, env: {} } });
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
