import { createTar } from "@hexclave/shared/dist/utils/tar";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

// These tests run against the vercel-mock docker service (see
// docker/dependencies/vercel-mock) — the backend's .env.development points at
// it via the mock HEXCLAVE_VERCEL_BEARER_TOKEN. CI never talks to real Vercel.
// Secret values are KMS-encrypted server-side via the local-kms container.
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

// Syncs service definitions the way `hexclave deploy` does (its first step
// after evaluating the config file's `services` export).
async function syncServices(services: Record<string, unknown>): Promise<void> {
  const response = await niceBackendFetch("/api/v1/deployments/services", {
    method: "PUT",
    accessType: "admin",
    body: { services },
  });
  if (response.status !== 200) throw new Error(`Failed to sync services: ${JSON.stringify(response.body)}`);
}

async function syncServiceAndUpload(serviceId: string, definition: Record<string, unknown> = {}, files?: Record<string, string>): Promise<{ uploadId: string }> {
  await syncServices({ [serviceId]: { type: "vercel", env: {}, ...definition } });
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
      body: { services: { web: { type: "vercel", env: {} } } },
    });
    expect(syncResponse.status).toBe(200);
    const secretsResponse = await niceBackendFetch("/api/v1/project-secrets", { accessType: "server" });
    expect(secretsResponse.status).toBe(200);
    const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "server" });
    expect(uploadResponse.status).toBe(201);
  });
});

describe("definition sync", () => {
  it("syncs, lists, and reads service definitions (read-only otherwise)", async ({ expect }) => {
    await Project.createAndSwitch();

    await syncServices({
      api: {
        type: "vercel",
        framework: "nextjs",
        install_command: "pnpm install",
        build_command: "pnpm build",
        output_directory: ".next",
        root_directory: "api",
        env: {
          MY_ENV_VAR: { value: "true" },
          DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
          OPENAI_KEY: { type: "secret", key: "OPENAI" },
          NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        },
      },
    });

    const getResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect(getResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "build_command": "pnpm build",
          "domains": [],
          "env": [
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
            {
              "key": "OPENAI_KEY",
              "secret_key": "OPENAI",
              "type": "secret",
              "value": null,
            },
          ],
          "framework": "nextjs",
          "has_successful_deploy": false,
          "id": "api",
          "install_command": "pnpm install",
          "latest_run": null,
          "output_directory": ".next",
          "provisioned": false,
          "root_directory": "api",
          "status": "not_deployed",
          "type": "vercel",
          "url": null,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Re-syncing updates in place; syncing OTHER services is additive (an
    // existing row is never removed by a sync that omits it — removal/cleanup
    // is deliberately out of scope).
    await syncServices({ web: { type: "vercel", env: {} } });
    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items.map((item: any) => item.id)).toEqual(["api", "web"]);
    await syncServices({ api: { type: "vercel", build_command: "pnpm build:prod", env: {} } });
    const updatedResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect((updatedResponse.body as any).build_command).toBe("pnpm build:prod");
    // Absent fields are unset, not kept (the config file is the whole truth).
    expect((updatedResponse.body as any).framework).toBe(null);
    expect((updatedResponse.body as any).env).toEqual([]);

    // There are no create/edit/delete routes anymore.
    const postResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "another" },
    });
    expect(postResponse.status).toBe(405);
    const patchResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "PATCH",
      accessType: "admin",
      body: { build_command: "x" },
    });
    expect(patchResponse.status).toBe(405);
    const deleteResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteResponse.status).toBe(405);
  });

  it("rejects invalid definitions", async ({ expect }) => {
    await Project.createAndSwitch();

    // The reserved managed-service id.
    const reservedResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { hexclave: { type: "vercel", env: {} } } },
    });
    expect(reservedResponse.status).toBe(400);

    // A secret with an inline value would defeat the point of secrets.
    const secretWithValue = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", env: { A: { type: "secret", key: "a", value: "leaked" } } } } },
    });
    expect(secretWithValue.status).toBe(400);

    // Secret defaults are a deploy-request input, never part of a definition:
    // a stored default would make the dashboard's secrets page report a value
    // that isn't actually stored anywhere, so the sync route refuses them
    // outright rather than dropping them silently.
    const secretWithDefault = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", env: { A: { type: "secret", key: "a", default_value: "y" } } } } },
    });
    // (The exact message is asserted in the schema's own unit tests; here the
    // point is that the route rejects it rather than storing it.)
    expect(secretWithDefault.status).toBe(400);

    // The config file's `devCommand` is run locally by `hexclave dev` and the
    // backend never acts on it, so there is no column for it and the route
    // refuses to be handed one (an older CLI still sending it must hear about
    // it rather than have it silently dropped).
    const withDevCommand = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", dev_command: "pnpm dev", env: { A: { value: "x" } } } } },
    });
    expect(withDevCommand.status).toBe(400);

    // The legacy `{service.output}` interpolation syntax is not a connection.
    const legacyReference = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", env: { A: { type: "connection", value: "{hexclave.projectId}" } } } } },
    });
    expect(legacyReference.status).toBe(400);

    // Env var keys must be valid env var names; a missing type is rejected.
    const invalidKey = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { type: "vercel", env: { "1-BAD-KEY": { value: "x" } } } } },
    });
    expect(invalidKey.status).toBe(400);
    const missingType = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: { web: { env: {} } } },
    });
    expect(missingType.status).toBe(400);

    // An empty sync is meaningless and gets a clear error.
    const emptySync = await niceBackendFetch("/api/v1/deployments/services", {
      method: "PUT",
      accessType: "admin",
      body: { services: {} },
    });
    expect(emptySync.status).toBe(400);
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

describe("deploys against the vercel-mock", () => {
  it("deploys end to end: sync, upload, provision, env resolution from stored secrets, status polling, and redacted logs", async ({ expect }) => {
    await Project.createAndSwitch();
    // The internal API key set also backs the hexclave.secretServerKey and
    // hexclave.publishableClientKey connection outputs.
    await InternalApiKey.createAndSetProjectKeys();
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project in context");

    // Secret VALUES only ever come from the per-project store — the deploy
    // request can supply a fallback default, never a value.
    await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "db_connection", value: "postgres://user:hunter2@db.example.com/app" },
    });
    // A stored value also beats the definition's default.
    await niceBackendFetch("/api/v1/project-secrets", {
      method: "POST",
      accessType: "admin",
      body: { key: "OVERRIDDEN", value: "stored-wins" },
    });

    const { uploadId } = await syncServiceAndUpload("api", {
      framework: "nextjs",
      build_command: "pnpm build",
      env: {
        HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        HEXCLAVE_SECRET_SERVER_KEY: { type: "connection", value: "hexclave.secretServerKey" },
        PLAIN_VALUE: { value: "hello-world" },
        DB_PASSWORD: { type: "secret", key: "db_connection" },
        FROM_DEFAULT: { type: "secret", key: "UNSET_WITH_DEFAULT" },
        OVERRIDDEN_VALUE: { type: "secret", key: "OVERRIDDEN" },
        // Regression test for the removal of the `{service.output}`
        // interpolation syntax: a plain value that LOOKS like the old
        // reference syntax must be pushed verbatim, never resolved.
        LOOKS_LIKE_A_REFERENCE: { value: "{hexclave.projectId}" },
      },
    });

    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "server",
      // Secret defaults ride along with the deploy (the CLI reads them from
      // `secret(key, default)`) and are never stored — nothing in the synced
      // definition above mentions them.
      body: {
        upload_id: uploadId,
        secret_defaults: { FROM_DEFAULT: "the-default", OVERRIDDEN_VALUE: "the-default" },
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
    expect((firstPoll.body as any).status).toBe("building");
    const secondPoll = await niceBackendFetch(`/api/v1/deployments/runs/${runId}`, { accessType: "admin" });
    expect((secondPoll.body as any).status).toBe("ready");
    expect((secondPoll.body as any).finished_at_millis).not.toBeNull();
    expect((secondPoll.body as any).url).toBe(`https://${mockProjectName("api")}.vercel-mock.localhost`);

    // The service now reports as deployed & provisioned.
    const serviceResponse = await niceBackendFetch("/api/v1/deployments/services/api", { accessType: "admin" });
    expect((serviceResponse.body as any).status).toBe("deployed");
    expect((serviceResponse.body as any).provisioned).toBe(true);
    expect((serviceResponse.body as any).has_successful_deploy).toBe(true);

    // Env vars were resolved server-side before being pushed to the target:
    // connections resolve to outputs, secrets to the stored values (falling
    // back to the request's defaults), and plain values pass through verbatim.
    const envValues = await fetchMockEnvValues("api");
    expect(envValues.HEXCLAVE_PROJECT_ID).toBe(projectKeys.projectId);
    expect(envValues.HEXCLAVE_SECRET_SERVER_KEY).toBe(projectKeys.secretServerKey);
    expect(envValues.PLAIN_VALUE).toBe("hello-world");
    expect(envValues.DB_PASSWORD).toBe("postgres://user:hunter2@db.example.com/app");
    expect(envValues.FROM_DEFAULT).toBe("the-default");
    expect(envValues.OVERRIDDEN_VALUE).toBe("stored-wins");
    expect(envValues.LOOKS_LIKE_A_REFERENCE).toBe("{hexclave.projectId}");

    // The build logs echo the build environment (mock behavior); the secret
    // server key AND the stored secret values must be redacted — unlike the
    // old `--secret` flow, stored secrets are persisted server-side, so we
    // can (and must) keep them out of the logs.
    const logsResponse = await niceBackendFetch(`/api/v1/deployments/runs/${runId}/logs`, { accessType: "admin" });
    expect(logsResponse.status).toBe(200);
    const logsText = typeof logsResponse.body === "string" ? logsResponse.body : JSON.stringify(logsResponse.body);
    expect(logsText).toContain("Build environment:");
    expect(logsText).toContain(`HEXCLAVE_PROJECT_ID=${projectKeys.projectId}`);
    expect(logsText).toContain("HEXCLAVE_SECRET_SERVER_KEY=<redacted>");
    expect(logsText).not.toContain(projectKeys.secretServerKey);
    expect(logsText).toContain("DB_PASSWORD=<redacted>");
    expect(logsText).not.toContain("hunter2");
  });

  it("rejects deploys with missing secrets or dangling connections without consuming the upload", async ({ expect }) => {
    await Project.createAndSwitch();

    // Secret env vars without a stored value, and without a default in the
    // deploy request. EVERY missing key must be listed at once: fixing them
    // means a trip to the dashboard, so learning about the second one only
    // after setting the first would be a round trip per secret.
    const { uploadId } = await syncServiceAndUpload("strict", {
      env: {
        DB_PASSWORD: { type: "secret", key: "db_connection" },
        API_TOKEN: { type: "secret", key: "api_token" },
      },
    });
    const missingSecretResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(missingSecretResponse.status).toBe(400);
    expect(missingSecretResponse.body).toContain("Missing values for secrets: api_token, db_connection");
    expect(missingSecretResponse.body).toContain("must be set in the dashboard under Project Settings > Secrets");

    // A default supplied with the deploy request satisfies one of them, so the
    // error narrows to what genuinely still needs a dashboard value.
    const partiallyDefaultedResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId, secret_defaults: { API_TOKEN: "from-config" } },
    });
    expect(partiallyDefaultedResponse.status).toBe(400);
    expect(partiallyDefaultedResponse.body).toContain("Missing values for secret: db_connection");

    // A connection to a service that doesn't exist.
    await syncServices({ strict: { type: "vercel", env: { OTHER_URL: { type: "connection", value: "nonexistent.url" } } } });
    const danglingConnectionResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(danglingConnectionResponse.status).toBe(400);
    expect(danglingConnectionResponse.body).toContain("points to a service that doesn't exist");

    // A connection to a defined-but-never-deployed service is also a deploy
    // error (deploys resolve strictly; the CLI's topological ordering is what
    // prevents this in practice).
    await syncServices({
      strict: { type: "vercel", env: { OTHER_URL: { type: "connection", value: "undeployed.url" } } },
      undeployed: { type: "vercel", env: {} },
    });
    const pendingConnectionResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(pendingConnectionResponse.status).toBe(400);
    expect(pendingConnectionResponse.body).toContain("no successful production deployment yet");

    // Self-references are typos that can never resolve.
    await syncServices({ strict: { type: "vercel", env: { MY_URL: { type: "connection", value: "strict.url" } } } });
    const selfRefResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(selfRefResponse.status).toBe(400);
    expect(selfRefResponse.body).toContain("cannot reference itself");

    // None of the failed attempts may have consumed the upload: the same
    // upload id must still deploy fine once the definition is valid.
    await syncServices({ strict: { type: "vercel", env: { PLAIN: { value: "x" } } } });
    const validResponse = await niceBackendFetch("/api/v1/deployments/services/strict/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(validResponse.status).toBe(200);
  });

  it("deploying a service that was never synced is a 404", async ({ expect }) => {
    await Project.createAndSwitch();
    const { uploadId } = await createUpload();
    const response = await niceBackendFetch("/api/v1/deployments/services/never-synced/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(response.status).toBe(404);
    expect(response.body).toContain("hexclave deploy");
  });

  it("reconciles the Vercel env when a redeploy's synced definition drops a key", async ({ expect }) => {
    await Project.createAndSwitch();

    const { uploadId } = await syncServiceAndUpload("recon", {
      env: {
        KEEP_ME: { value: "kept" },
        REMOVE_ME: { value: "stale" },
      },
    });
    const firstDeploy = await niceBackendFetch("/api/v1/deployments/services/recon/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(firstDeploy.status).toBe(200);
    expect((await fetchMockEnvValues("recon")).REMOVE_ME).toBe("stale");

    // A re-sync with a reduced env set + redeploy must delete the removed key
    // from the Vercel project, not let it linger in future builds.
    const { uploadId: secondUploadId } = await syncServiceAndUpload("recon", {
      env: { KEEP_ME: { value: "kept" } },
    });
    const secondDeploy = await niceBackendFetch("/api/v1/deployments/services/recon/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: secondUploadId },
    });
    expect(secondDeploy.status).toBe(200);
    const envValues = await fetchMockEnvValues("recon");
    expect(envValues.KEEP_ME).toBe("kept");
    expect(envValues.REMOVE_ME).toBeUndefined();
  });

  it("resolves connections to another service's production url", async ({ expect }) => {
    await Project.createAndSwitch();

    // Deploy the producer to READY first (this is what the CLI's topological
    // deploy order guarantees).
    const { uploadId } = await syncServiceAndUpload("api");
    const apiDeploy = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
    });
    expect(apiDeploy.status).toBe(200);
    await pollRunToReady((apiDeploy.body as any).run_id);

    const { uploadId: frontUploadId } = await syncServiceAndUpload("front", {
      env: { API_URL: { type: "connection", value: "api.url" } },
    });
    const frontDeploy = await niceBackendFetch("/api/v1/deployments/services/front/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: frontUploadId },
    });
    expect(frontDeploy.status).toBe(200);
    expect((await fetchMockEnvValues("front")).API_URL).toBe(`https://${mockProjectName("api")}.vercel-mock.localhost`);
  });

  it("marks a failing build as errored", async ({ expect }) => {
    await Project.createAndSwitch();
    // The mock fails any build whose build command contains this marker.
    const { uploadId } = await syncServiceAndUpload("failing", { build_command: "fail-this-build" });
    const deployResponse = await niceBackendFetch("/api/v1/deployments/services/failing/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: uploadId },
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
    await syncServices({ api: { type: "vercel", env: {} } });

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
    await syncServices({ web: { type: "vercel", env: {} } });

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
