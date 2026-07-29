import { createTar } from "@hexclave/shared/dist/utils/tar";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

// These tests run against the vercel-mock docker service (see
// docker/dependencies/vercel-mock) — the backend's .env.development points at
// it via the mock HEXCLAVE_VERCEL_BEARER_TOKEN. CI never talks to real Vercel.
const VERCEL_MOCK_URL = `http://localhost:${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81"}26`;

function makeSourceTarball(files: Record<string, string> = { "index.html": "<h1>hello</h1>" }): Uint8Array {
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
    throw new Error(`Upload response is missing the presigned URL or content type: ${JSON.stringify(uploadResponse.body)}`);
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

async function createServiceAndUpload(serviceId: string, files?: Record<string, string>): Promise<{ uploadId: string }> {
  const createResponse = await niceBackendFetch("/api/v1/deployments/services", {
    method: "POST",
    accessType: "admin",
    body: { id: serviceId },
  });
  if (createResponse.status !== 201) throw new Error(`Failed to create service: ${JSON.stringify(createResponse.body)}`);
  return await createUpload(files);
}

// The mock advances a deployment one state per read (queued -> building ->
// ready), so two run polls settle it.
async function pollRunToReady(runId: string): Promise<void> {
  await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
  const secondPoll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
  if ((secondPoll.body as any).status !== "ready") throw new Error(`Run did not become ready: ${JSON.stringify(secondPoll.body)}`);
}

function mockProjectName(serviceId: string): string {
  const projectKeys = backendContext.value.projectKeys;
  if (projectKeys === "no-project") throw new Error("No project in context");
  const readable = `hxc-${projectKeys.projectId}-${serviceId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const hash = createHash("sha256").update(JSON.stringify([projectKeys.projectId, serviceId])).digest("hex").slice(0, 12);
  return `${readable.slice(0, 87).replace(/-+$/, "")}-${hash}`;
}

async function fetchMockEnvValues(serviceId: string): Promise<Record<string, string>> {
  const projectName = mockProjectName(serviceId);
  const response = await fetch(`${VERCEL_MOCK_URL}/__mock/projects/${encodeURIComponent(projectName)}/env-values`, {
    headers: { authorization: "Bearer mock_hexclave_vercel_key" },
  });
  if (!response.ok) throw new Error(`vercel-mock env-values returned ${response.status}`);
  return (await response.json()).values;
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
  });

  it("accepts secret-server-key access (the CLI's CI auth)", async ({ expect }) => {
    await Project.createAndSwitch();
    await InternalApiKey.createAndSetProjectKeys();
    const response = await niceBackendFetch("/api/v1/deployments/services", { accessType: "server" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "items": [] },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("service CRUD", () => {
  it("creates, reads, updates, and deletes a service definition", async ({ expect }) => {
    await Project.createAndSwitch();

    const createResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "api", framework: "nextjs", install_command: "pnpm install", build_command: "pnpm build", output_directory: ".next", root_directory: "./api" },
    });
    expect(createResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 201,
        "body": {
          "build_command": "pnpm build",
          "domains": [],
          "env": [],
          "framework": "nextjs",
          "has_successful_deploy": false,
          "id": "api",
          "install_command": "pnpm install",
          "latest_run": null,
          "output_directory": ".next",
          "provisioned": false,
          "root_directory": "./api",
          "status": "not_deployed",
          "type": "vercel",
          "url": null,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Duplicate id is rejected.
    const duplicateResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "api" },
    });
    expect(duplicateResponse.status).toBe(400);

    // The reserved managed-service id is rejected.
    const reservedResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "hexclave" },
    });
    expect(reservedResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "The service id \\"hexclave\\" is reserved for the managed Hexclave service.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const patchResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "PATCH",
      accessType: "admin",
      body: { build_command: "pnpm build:prod" },
    });
    expect(patchResponse.status).toBe(200);
    expect((patchResponse.body as any).build_command).toBe("pnpm build:prod");

    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items.map((item: any) => item.id)).toEqual(["api"]);

    const deleteResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
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

    const getAfterDelete = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect(getAfterDelete.status).toBe(404);
  });

  it("manages definition env vars of all three types on an unprovisioned service", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "web" },
    });
    const patchResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: {
        env: {
          MY_ENV_VAR: { value: "true" },
          DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
          NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        },
      },
    });
    expect(patchResponse.status).toBe(200);
    expect((patchResponse.body as any).env).toMatchInlineSnapshot(`
      [
        {
          "key": "DATABASE_CONNECTION_STRING",
          "secret_key": "db_connection",
          "type": "secret",
          "value": null,
        },
        {
          "key": "MY_ENV_VAR",
          "secret_key": null,
          "type": "plain",
          "value": "true",
        },
        {
          "key": "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID",
          "secret_key": null,
          "type": "connection",
          "value": "hexclave.projectId",
        },
      ]
    `);

    const invalidKeyResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { "1-BAD-KEY": { value: "x" } } },
    });
    expect(invalidKeyResponse.status).toBe(400);

    // A secret with an inline value would defeat the point of secrets.
    const secretWithValueResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { A: { type: "secret", key: "a", value: "leaked" } } },
    });
    expect(secretWithValueResponse.status).toBe(400);

    // The legacy `{service.output}` interpolation syntax is not a connection.
    const legacyReferenceResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { A: { type: "connection", value: "{hexclave.projectId}" } } },
    });
    expect(legacyReferenceResponse.status).toBe(400);
  });
});

describe("read-only enforcement for pushed config sources", () => {
  it("blocks definition edits (including env vars) but allows domains when the config is pushed from GitHub", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.pushConfig({
      "deployments-alpha": {
        services: {
          api: {
            type: "vercel",
            framework: "nextjs",
            buildCommand: "pnpm build",
            env: {
              SOME_KEY: { value: "some-value" },
            },
          },
        },
      },
    }, {
      type: "pushed-from-github",
      owner: "acme",
      repo: "monorepo",
      branch: "main",
      commit_hash: "0000000000000000000000000000000000000000",
      config_file_path: "hexclave.config.ts",
    });

    // The pushed definition is visible, including its env vars.
    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items.map((item: any) => ({ id: item.id, framework: item.framework, env: item.env }))).toEqual([{
      id: "api",
      framework: "nextjs",
      env: [{ key: "SOME_KEY", type: "plain", value: "some-value", secret_key: null }],
    }]);

    const createResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "another" },
    });
    expect(createResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "This project's configuration is managed by GitHub, so deployment services can't be edited here. Edit the \`deployments-alpha.services\` section of your hexclave.config.ts instead.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const patchBuildResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "PATCH",
      accessType: "admin",
      body: { build_command: "pnpm build:evil" },
    });
    expect(patchBuildResponse.status).toBe(400);

    const deleteResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteResponse.status).toBe(400);

    // Env vars are part of the definition now, so they are read-only too.
    const envPatchResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { SOME_KEY: { value: "changed" } } },
    });
    expect(envPatchResponse.status).toBe(400);

    // Domains are operational state (not part of the definition), so they stay
    // manageable even for GitHub-sourced configs.
    const addDomainResponse = await niceBackendFetch("/api/v1/deployments/services/api/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "app.example.com" },
    });
    expect(addDomainResponse.status).toBe(201);
  });

  // Removing a service through a whole-config write is NOT a teardown: only the
  // dashboard's DELETE route deletes the Vercel project. This pins the current
  // (leaky) behaviour so it changes deliberately — see the "KNOWN GAP" note in
  // the backend's lib/deployments, and the cron sweep that should replace it.
  it("hides a service but keeps its Vercel project when a config push removes it", async ({ expect }) => {
    await Project.createAndSwitch();
    const pushedSource = {
      type: "pushed-from-github" as const,
      owner: "acme",
      repo: "monorepo",
      branch: "main",
      commit_hash: "0000000000000000000000000000000000000000",
      config_file_path: "hexclave.config.ts",
    };
    await Project.pushConfig({
      "deployments-alpha": {
        services: {
          orphan: { type: "vercel" },
        },
      },
    }, pushedSource);
    const { uploadId } = await createUpload();
    const firstDeploy = await niceBackendFetch("/api/v1/deployments/services/orphan/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(firstDeploy.status).toBe(200);

    const provisionedProjectResponse = await fetch(`${VERCEL_MOCK_URL}/v9/projects/${encodeURIComponent(mockProjectName("orphan"))}?teamId=team_mock_hexclave`, {
      headers: { authorization: "Bearer mock_hexclave_vercel_key" },
    });
    expect(provisionedProjectResponse.status).toBe(200);

    await Project.pushConfig({ "deployments-alpha": { services: {} } }, pushedSource);

    // The service is gone from the API, because listings are built from the
    // config definitions and never from the leftover operational row.
    const listAfterRemoval = await niceBackendFetch("/api/v1/deployments/services", {
      accessType: "admin",
    });
    expect(listAfterRemoval.status).toBe(200);
    expect((listAfterRemoval.body as any).items.map((item: any) => item.id)).not.toContain("orphan");

    // ...but its Vercel project is still live. This is the leak.
    const removedProjectResponse = await fetch(`${VERCEL_MOCK_URL}/v9/projects/${encodeURIComponent(mockProjectName("orphan"))}?teamId=team_mock_hexclave`, {
      headers: { authorization: "Bearer mock_hexclave_vercel_key" },
    });
    expect(removedProjectResponse.status).toBe(200);

    // Re-adding the same service id picks the surviving operational row back
    // up and redeploys onto the same project instead of provisioning a new one.
    await Project.pushConfig({
      "deployments-alpha": {
        services: {
          orphan: { type: "vercel" },
        },
      },
    }, pushedSource);
    const { uploadId: secondUploadId } = await createUpload();
    const secondDeploy = await niceBackendFetch("/api/v1/deployments/services/orphan/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: secondUploadId },
    });
    expect(secondDeploy.status).toBe(200);
  });
});

describe("deploys against the vercel-mock", () => {
  it("deploys end to end: upload, provision, env resolution, status polling, and redacted logs", async ({ expect }) => {
    await Project.createAndSwitch();
    // The internal API key set also backs the {hexclave.secretServerKey} and
    // {hexclave.publishableClientKey} env var references.
    await InternalApiKey.createAndSetProjectKeys();
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");

    const { uploadId } = await createServiceAndUpload("api");

    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "server",
      body: {
        upload_id: uploadId,
        build_config: { framework: "nextjs", build_command: "pnpm build" },
        env: {
          HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
          HEXCLAVE_SECRET_SERVER_KEY: { type: "connection", value: "hexclave.secretServerKey" },
          PLAIN_VALUE: { value: "hello-world" },
          DB_PASSWORD: { type: "secret", key: "db_connection" },
          // Regression test for the removal of the `{service.output}`
          // interpolation syntax: a plain value that LOOKS like the old
          // reference syntax must be pushed verbatim, never resolved.
          LOOKS_LIKE_A_REFERENCE: { value: "{hexclave.projectId}" },
        },
        secrets: {
          db_connection: "postgres://user:hunter2@db.example.com/app",
        },
      },
    });
    expect(deployResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "run_id": "<stripped UUID>" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const runId = (deployResponse.body as any).run_id;

    // The mock advances one state per poll: queued -> building -> ready.
    const firstPoll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    expect((firstPoll.body as any).url).toBe(`https://${mockProjectName("api")}.vercel-mock.localhost`);
    (firstPoll.body as any).url = "<deployment URL>";
    expect(firstPoll).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "error": null,
          "finished_at_millis": null,
          "id": "<stripped UUID>",
          "service_id": "api",
          "status": "building",
          "target": "production",
          "triggered_by": "server",
          "url": "<deployment URL>",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const secondPoll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    expect((secondPoll.body as any).status).toBe("ready");
    expect((secondPoll.body as any).finished_at_millis).not.toBeNull();

    // The service now reports as deployed & provisioned.
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect((serviceResponse.body as any).status).toBe("deployed");
    expect((serviceResponse.body as any).provisioned).toBe(true);
    expect((serviceResponse.body as any).has_successful_deploy).toBe(true);

    // Env vars were resolved server-side before being pushed to the target:
    // connections resolve to outputs, secrets to the --secret values, and
    // plain values pass through verbatim — even when they look like the old
    // `{service.output}` interpolation syntax.
    const envValues = await fetchMockEnvValues("api");
    expect(envValues.HEXCLAVE_PROJECT_ID).toBe(projectKeys.projectId);
    expect(envValues.HEXCLAVE_SECRET_SERVER_KEY).toBe(projectKeys.secretServerKey);
    expect(envValues.PLAIN_VALUE).toBe("hello-world");
    expect(envValues.DB_PASSWORD).toBe("postgres://user:hunter2@db.example.com/app");
    expect(envValues.LOOKS_LIKE_A_REFERENCE).toBe("{hexclave.projectId}");

    // The build logs echo the build environment (mock behavior); the secret
    // server key must be redacted, non-secrets stay readable. Known
    // limitation, pinned deliberately: --secret values are never persisted by
    // Hexclave, so they CANNOT be redacted from later log reads — improving
    // this requires a conscious design change (e.g. storing salted value
    // hashes), not an accident.
    const logsResponse = await niceBackendFetch(`/api/v1/deployments/runs/${runId}/logs`, { accessType: "admin" });
    expect(logsResponse.status).toBe(200);
    const logsText = typeof logsResponse.body === "string" ? logsResponse.body : JSON.stringify(logsResponse.body);
    expect(logsText).toContain("Build environment:");
    expect(logsText).toContain(`HEXCLAVE_PROJECT_ID=${projectKeys.projectId}`);
    expect(logsText).toContain("HEXCLAVE_SECRET_SERVER_KEY=<redacted>");
    expect(logsText).not.toContain(projectKeys.secretServerKey);
    expect(logsText).toContain("DB_PASSWORD=postgres://user:hunter2@db.example.com/app");
  });

  it("rejects deploys with missing, unknown, or dangling env references without consuming the upload", async ({ expect }) => {
    await Project.createAndSwitch();
    const { uploadId } = await createServiceAndUpload("strict");

    // Secret env var without a matching secret value.
    const missingSecretResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: { DB_PASSWORD: { type: "secret", key: "db_connection" } },
      },
    });
    expect(missingSecretResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Missing secret values for: db_connection. This service's env vars reference these secrets — pass them with \`--secret <key>=<value>\`.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // A secret that no env var references is a typo, not a no-op.
    const unknownSecretResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: { PLAIN: { value: "x" } },
        secrets: { db_connectoin: "oops" },
      },
    });
    expect(unknownSecretResponse.status).toBe(400);
    expect(unknownSecretResponse.body).toContain("Unknown secrets: db_connectoin");

    // A connection to a service that doesn't exist.
    const danglingConnectionResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: { OTHER_URL: { type: "connection", value: "nonexistent.url" } },
      },
    });
    expect(danglingConnectionResponse.status).toBe(400);
    expect(danglingConnectionResponse.body).toContain("points to a service that doesn't exist");

    // None of the failed attempts may have consumed the upload: the same
    // upload id must still deploy fine once the request is valid.
    const validResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: { DB_PASSWORD: { type: "secret", key: "db_connection" } },
        secrets: { db_connection: "hunter2" },
      },
    });
    expect(validResponse.status).toBe(200);
  });

  it("reconciles the Vercel env on redeploy and uses the stored definition when the request omits env", async ({ expect }) => {
    await Project.createAndSwitch();
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");

    // First deploy: two plain vars and a secret, persisted config-as-code.
    const { uploadId } = await createServiceAndUpload("recon");
    const firstDeploy = await niceBackendFetch("/api/v1/deployments/services/recon/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: {
          KEEP_ME: { value: "kept" },
          REMOVE_ME: { value: "stale" },
          DB_PASSWORD: { type: "secret", key: "db_connection" },
        },
        secrets: { db_connection: "hunter2" },
      },
    });
    expect(firstDeploy.status).toBe(200);
    expect((await fetchMockEnvValues("recon")).REMOVE_ME).toBe("stale");

    // The persisted definition exposes the secret's NAME only — the value must
    // not appear anywhere readable.
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/recon", { accessType: "admin" });
    expect((serviceResponse.body as any).env).toEqual([
      { key: "DB_PASSWORD", type: "secret", value: null, secret_key: "db_connection" },
      { key: "KEEP_ME", type: "plain", value: "kept", secret_key: null },
      { key: "REMOVE_ME", type: "plain", value: "stale", secret_key: null },
    ]);
    expect(JSON.stringify(serviceResponse.body)).not.toContain("hunter2");

    // Redeploy WITHOUT env: the stored definition governs, so the secret is
    // still demanded — this is exactly what the CLI's dashboard mode relies on.
    const { uploadId: secondUploadId } = await createUpload();
    const missingSecret = await niceBackendFetch("/api/v1/deployments/services/recon/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: secondUploadId },
    });
    expect(missingSecret.status).toBe(400);
    expect(missingSecret.body).toContain("Missing secret values for: db_connection");

    // Redeploy with a REDUCED env set: the removed key must be deleted from
    // the Vercel project, not linger in future builds (deploys reconcile, not
    // just upsert — CLI/GitHub-managed configs have no other removal path).
    const reducedDeploy = await niceBackendFetch("/api/v1/deployments/services/recon/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: secondUploadId,
        env: {
          KEEP_ME: { value: "kept" },
          DB_PASSWORD: { type: "secret", key: "db_connection" },
        },
        secrets: { db_connection: "hunter2" },
      },
    });
    expect(reducedDeploy.status).toBe(200);
    const envValues = await fetchMockEnvValues("recon");
    expect(envValues.KEEP_ME).toBe("kept");
    expect(envValues.DB_PASSWORD).toBe("hunter2");
    expect(envValues.REMOVE_ME).toBeUndefined();
  });

  it("pushes dashboard env edits through to a provisioned service, deferring secrets and pending connections", async ({ expect }) => {
    await Project.createAndSwitch();
    const { uploadId } = await createServiceAndUpload("editable");
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/editable/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: {
          CHANGE_ME: { value: "before" },
          REMOVE_ME: { value: "stale" },
          DB_PASSWORD: { type: "secret", key: "db_connection" },
        },
        secrets: { db_connection: "hunter2" },
      },
    });
    expect(deployResponse.status).toBe(200);

    // A second service that exists but has never deployed — a connection to it
    // is a legitimate PENDING state that must not fail the save (deploy order
    // must not matter when wiring services up).
    await niceBackendFetch("/api/v1/deployments/services", { method: "POST", accessType: "admin", body: { id: "undeployed" } });

    const patchResponse = await niceBackendFetch("/api/v1/deployments/services/editable", {
      method: "PATCH",
      accessType: "admin",
      body: {
        env: {
          CHANGE_ME: { value: "after" },
          DB_PASSWORD: { type: "secret", key: "db_connection" },
          PENDING_URL: { type: "connection", value: "undeployed.url" },
        },
      },
    });
    expect(patchResponse.status).toBe(200);

    const envValues = await fetchMockEnvValues("editable");
    expect(envValues.CHANGE_ME).toBe("after");
    // Removed from the definition -> deleted from the Vercel project.
    expect(envValues.REMOVE_ME).toBeUndefined();
    // Secret entries are skipped by the write-through (no value exists at save
    // time); the deploy-time value stays until the next deploy.
    expect(envValues.DB_PASSWORD).toBe("hunter2");
    // The pending connection is skipped, not pushed and not an error.
    expect(envValues.PENDING_URL).toBeUndefined();

    // Static typos, in contrast, must reject the save — they can never become
    // resolvable later.
    const danglingPatch = await niceBackendFetch("/api/v1/deployments/services/editable", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { OOPS: { type: "connection", value: "nonexistent.url" } } },
    });
    expect(danglingPatch.status).toBe(400);
    expect(danglingPatch.body).toContain("points to a service that doesn't exist");
    const selfRefPatch = await niceBackendFetch("/api/v1/deployments/services/editable", {
      method: "PATCH",
      accessType: "admin",
      body: { env: { MY_URL: { type: "connection", value: "editable.url" } } },
    });
    expect(selfRefPatch.status).toBe(400);
    expect(selfRefPatch.body).toContain("cannot reference itself");
  });

  it("resolves connections to another service's production url", async ({ expect }) => {
    await Project.createAndSwitch();
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");

    // Deploy the producer to READY first.
    const { uploadId } = await createServiceAndUpload("api");
    const apiDeploy = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(apiDeploy.status).toBe(200);
    await pollRunToReady((apiDeploy.body as any).run_id);

    // The consumer's connection resolves to the producer's latest READY
    // production deployment URL (the mock's URLs are deterministic).
    const { uploadId: frontUploadId } = await createServiceAndUpload("front");
    const frontDeploy = await niceBackendFetch("/api/v1/deployments/services/front/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: frontUploadId,
        env: { API_URL: { type: "connection", value: "api.url" } },
      },
    });
    expect(frontDeploy.status).toBe(200);
    expect((await fetchMockEnvValues("front")).API_URL).toBe(`https://${mockProjectName("api")}.vercel-mock.localhost`);
  });

  it("applies request build config and env to builds on GitHub-managed configs without persisting them", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.pushConfig({
      "deployments-alpha": {
        services: {
          api: {
            type: "vercel",
            env: {
              FROM_REPO: { value: "repo-value" },
            },
          },
        },
      },
    }, {
      type: "pushed-from-github",
      owner: "acme",
      repo: "monorepo",
      branch: "main",
      commit_hash: "0000000000000000000000000000000000000000",
      config_file_path: "hexclave.config.ts",
    });

    // Deploying a service the repo doesn't define is rejected before anything
    // is consumed.
    const { uploadId } = await createUpload();
    const unknownService = await niceBackendFetch("/api/v1/deployments/services/other/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(unknownService.status).toBe(400);
    expect(unknownService.body).toContain("managed by GitHub");

    // The request's env governs THIS build (the CLI sends the same file
    // content the repo holds) — but nothing is persisted: the rendered
    // definition still shows the repo's env afterwards.
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        env: { FROM_REQUEST: { value: "request-value" } },
      },
    });
    expect(deployResponse.status).toBe(200);
    expect((await fetchMockEnvValues("api")).FROM_REQUEST).toBe("request-value");
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect((serviceResponse.body as any).env).toEqual([
      { key: "FROM_REPO", type: "plain", value: "repo-value", secret_key: null },
    ]);
  });

  it("unsets stored build config fields when the deploy request sends null", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "web", build_command: "pnpm build:custom", framework: "nextjs" },
    });
    // The CLI sends null for fields absent from the config file — deleting a
    // field there must actually clear the stored value (fall back to platform
    // auto-detection), not silently keep it forever.
    const { uploadId } = await createUpload();
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/web/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        build_config: { framework: "nextjs", build_command: null },
      },
    });
    expect(deployResponse.status).toBe(200);
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/web", { accessType: "admin" });
    expect((serviceResponse.body as any).build_command).toBe(null);
    expect((serviceResponse.body as any).framework).toBe("nextjs");
  });

  it("marks a failing build as errored", async ({ expect }) => {
    await Project.createAndSwitch();
    const { uploadId } = await createServiceAndUpload("failing");
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/failing/deploy", {
      method: "POST",
      accessType: "admin",
      body: {
        upload_id: uploadId,
        // The mock fails any build whose build command contains this marker.
        build_config: { build_command: "fail-this-build" },
      },
    });
    expect(deployResponse.status).toBe(200);
    const runId = (deployResponse.body as any).run_id;
    await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    const secondPoll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    expect((secondPoll.body as any).status).toBe("error");
    expect((secondPoll.body as any).error).toMatchInlineSnapshot(`"Build failed with exit code 1"`);
  });

  it("rejects invalid uploads and consumes each upload slot once", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "api" },
    });

    // Deploy with a nonexistent upload.
    const missingUploadResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: "00000000-0000-4000-8000-000000000001" },
    });
    expect(missingUploadResponse.status).toBe(404);

    const { uploadId } = await createUpload();

    // A non-gzip upload is rejected at deploy time with a clean 400.
    const badUploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "admin" });
    const badBytes = new TextEncoder().encode("definitely not a gzip stream");
    const badPutResponse = await fetch((badUploadResponse.body as any).upload_url, {
      method: "PUT",
      headers: {
        "content-type": (badUploadResponse.body as any).content_type,
        "content-length": badBytes.length.toString(),
      },
      body: new Uint8Array(badBytes).slice().buffer,
    });
    expect(badPutResponse.ok).toBe(true);
    const badDeployResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: (badUploadResponse.body as any).id },
    });
    expect(badDeployResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Uploaded source is not a valid gzip stream.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Consumed uploads can't be reused: deploy once, then replay the request.
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(deployResponse.status).toBe(200);
    const replayResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(replayResponse.status).toBe(404);
  });
});

describe("domains", () => {
  it("adds domains, reads back DNS records, and removes them", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "web" },
    });

    // Before the first deploy: the domain is stored, DNS guidance is generic.
    const addResponse = await niceBackendFetch("/api/v1/deployments/services/web/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "app.example.com", is_primary: true },
    });
    expect(addResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 201,
        "body": {
          "hostname": "app.example.com",
          "is_primary": true,
          "verified": false,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const preDeployDetails = await niceBackendFetch("/api/v1/deployments/services/web/domains/app.example.com", { accessType: "admin" });
    expect(preDeployDetails).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "dns_records": [
            {
              "name": "app",
              "type": "CNAME",
              "value": "cname.vercel-dns.com",
            },
          ],
          "hostname": "app.example.com",
          "is_primary": true,
          "pending_first_deploy": true,
          "verified": false,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Duplicates and URLs (instead of hostnames) are rejected.
    const duplicateResponse = await niceBackendFetch("/api/v1/deployments/services/web/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "app.example.com" },
    });
    expect(duplicateResponse.status).toBe(400);
    const urlResponse = await niceBackendFetch("/api/v1/deployments/services/web/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "https://app.example.com" },
    });
    expect(urlResponse.status).toBe(400);

    // Deploy so the service gets provisioned; the stored domain is synced
    // to the target and Vercel's verification state takes over.
    const { uploadId } = await createUpload();
    await niceBackendFetch("/api/v1/deployments/services/web/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });

    const postDeployDetails = await niceBackendFetch("/api/v1/deployments/services/web/domains/app.example.com", { accessType: "admin" });
    expect(postDeployDetails).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "dns_records": [
            {
              "name": "app",
              "type": "CNAME",
              "value": "cname.vercel-dns.com",
            },
            {
              "name": "_vercel.example.com",
              "type": "TXT",
              "value": "vc-domain-verify=app.example.com,mock0000",
            },
          ],
          "hostname": "app.example.com",
          "is_primary": true,
          "pending_first_deploy": false,
          "verified": false,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // The mock auto-verifies *.verified.test domains — verified domains have
    // no pending DNS records.
    await niceBackendFetch("/api/v1/deployments/services/web/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "web.verified.test" },
    });
    const verifiedDetails = await niceBackendFetch("/api/v1/deployments/services/web/domains/web.verified.test", { accessType: "admin" });
    expect((verifiedDetails.body as any).verified).toBe(true);
    expect((verifiedDetails.body as any).dns_records).toEqual([]);

    // A failing ownership check (Vercel's verify endpoint answers 400
    // missing_txt_record) is the normal pending state, NOT an error: the read
    // must still succeed and include the outstanding TXT challenge.
    await niceBackendFetch("/api/v1/deployments/services/web/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "claimed.txt-challenge.test" },
    });
    const challengedDetails = await niceBackendFetch("/api/v1/deployments/services/web/domains/claimed.txt-challenge.test", { accessType: "admin" });
    expect(challengedDetails.status).toBe(200);
    expect((challengedDetails.body as any).verified).toBe(false);
    expect((challengedDetails.body as any).dns_records.some((record: any) => record.type === "TXT")).toBe(true);

    // Removal drops the domain from the service.
    const removeResponse = await niceBackendFetch("/api/v1/deployments/services/web/domains/app.example.com", {
      method: "DELETE",
      accessType: "admin",
    });
    expect(removeResponse.status).toBe(200);
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/web", { accessType: "admin" });
    expect((serviceResponse.body as any).domains.map((domain: any) => domain.hostname).sort()).toEqual(["claimed.txt-challenge.test", "web.verified.test"]);
  });
});
