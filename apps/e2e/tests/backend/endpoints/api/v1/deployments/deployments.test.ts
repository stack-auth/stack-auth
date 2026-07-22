import { createTar } from "@hexclave/shared/dist/utils/tar";
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

async function createServiceAndUpload(serviceId: string, files?: Record<string, string>): Promise<{ uploadId: string }> {
  const createResponse = await niceBackendFetch("/api/v1/deployments/services", {
    method: "POST",
    accessType: "admin",
    body: { id: serviceId },
  });
  if (createResponse.status !== 201) throw new Error(`Failed to create service: ${JSON.stringify(createResponse.body)}`);
  const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", {
    method: "POST",
    accessType: "admin",
  });
  if (uploadResponse.status !== 201) throw new Error(`Failed to create upload: ${JSON.stringify(uploadResponse.body)}`);
  const putResponse = await niceBackendFetch((uploadResponse.body as any).upload_path.replace("/api/latest/", "/api/v1/"), {
    method: "PUT",
    accessType: "admin",
    rawBody: makeSourceTarball(files),
  });
  if (putResponse.status !== 200) throw new Error(`Failed to upload tarball: ${JSON.stringify(putResponse.body)}`);
  return { uploadId: (uploadResponse.body as any).id };
}

async function fetchMockEnvValues(serviceId: string): Promise<Record<string, string>> {
  const projectKeys = backendContext.value.projectKeys;
  if (projectKeys === "no-project") throw new Error("No project in context");
  const projectName = `hxc-${projectKeys.projectId}-${serviceId}`;
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
          "env_vars": [],
          "framework": "nextjs",
          "has_successful_deploy": false,
          "id": "api",
          "install_command": "pnpm install",
          "latest_run": null,
          "output_directory": ".next",
          "provisioned": false,
          "root_directory": "./api",
          "status": "not_deployed",
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

  it("manages dashboard env vars on an unprovisioned service", async ({ expect }) => {
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
        env_vars: [
          { key: "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", value: "{hexclave.projectId}" },
          { key: "SOME_SECRET", value: "super-secret-value", is_secret: true },
        ],
      },
    });
    expect(patchResponse.status).toBe(200);
    expect((patchResponse.body as any).env_vars).toMatchInlineSnapshot(`
      [
        {
          "id": "<stripped UUID>",
          "is_secret": false,
          "key": "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID",
          "value": "{hexclave.projectId}",
        },
        {
          "id": "<stripped UUID>",
          "is_secret": true,
          "key": "SOME_SECRET",
          "value": "super-secret-value",
        },
      ]
    `);

    const invalidKeyResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: { env_vars: [{ key: "1-BAD-KEY", value: "x" }] },
    });
    expect(invalidKeyResponse.status).toBe(400);

    const duplicateKeyResponse = await niceBackendFetch("/api/v1/deployments/services/web", {
      method: "PATCH",
      accessType: "admin",
      body: { env_vars: [{ key: "A", value: "1" }, { key: "A", value: "2" }] },
    });
    expect(duplicateKeyResponse.status).toBe(400);
  });
});

describe("read-only enforcement for pushed config sources", () => {
  it("blocks definition edits but allows env vars when the config is pushed from GitHub", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.pushConfig({
      deployments: {
        services: {
          api: {
            framework: "nextjs",
            buildCommand: "pnpm build",
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

    // The pushed definition is visible.
    const listResponse = await niceBackendFetch("/api/v1/deployments/services", { accessType: "admin" });
    expect((listResponse.body as any).items.map((item: any) => ({ id: item.id, framework: item.framework }))).toEqual([{ id: "api", framework: "nextjs" }]);

    const createResponse = await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "another" },
    });
    expect(createResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "This project's configuration is managed by GitHub, so deployment services can't be edited here. Edit the \`deployments.services\` section of your hexclave.config.ts instead.",
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

    const addDomainResponse = await niceBackendFetch("/api/v1/deployments/services/api/domains", {
      method: "POST",
      accessType: "admin",
      body: { hostname: "app.example.com" },
    });
    expect(addDomainResponse.status).toBe(400);

    // Env vars are operational, not part of the definition — still editable.
    const envPatchResponse = await niceBackendFetch("/api/v1/deployments/services/api", {
      method: "PATCH",
      accessType: "admin",
      body: { env_vars: [{ key: "SOME_KEY", value: "some-value" }] },
    });
    expect(envPatchResponse.status).toBe(200);
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
        env: [
          { key: "HEXCLAVE_PROJECT_ID", value: "{hexclave.projectId}" },
          { key: "HEXCLAVE_SECRET_SERVER_KEY", value: "{hexclave.secretServerKey}" },
          { key: "PLAIN_VALUE", value: "hello-world" },
        ],
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
          "url": "https://hxc-<stripped UUID>-api.vercel-mock.localhost",
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

    // Env vars were resolved server-side before being pushed to the target.
    const envValues = await fetchMockEnvValues("api");
    expect(envValues.HEXCLAVE_PROJECT_ID).toBe(projectKeys.projectId);
    expect(envValues.HEXCLAVE_SECRET_SERVER_KEY).toBe(projectKeys.secretServerKey);
    expect(envValues.PLAIN_VALUE).toBe("hello-world");

    // The build logs echo the build environment (mock behavior); the secret
    // server key must be redacted, non-secrets stay readable.
    const logsResponse = await niceBackendFetch(`/api/v1/deployments/runs/${runId}/logs`, { accessType: "admin" });
    expect(logsResponse.status).toBe(200);
    const logsText = typeof logsResponse.body === "string" ? logsResponse.body : JSON.stringify(logsResponse.body);
    expect(logsText).toContain("Build environment:");
    expect(logsText).toContain(`HEXCLAVE_PROJECT_ID=${projectKeys.projectId}`);
    expect(logsText).toContain("HEXCLAVE_SECRET_SERVER_KEY=<redacted>");
    expect(logsText).not.toContain(projectKeys.secretServerKey);

    // Runtime logs live-tail: the mock emits a few request lines plus an env
    // dump, which must be redacted the same way as build logs.
    const runtimeLogsResponse = await niceBackendFetch("/api/v1/deployments/services/api/runtime-logs", { accessType: "admin" });
    expect(runtimeLogsResponse.status).toBe(200);
    const runtimeLogsText = typeof runtimeLogsResponse.body === "string" ? runtimeLogsResponse.body : JSON.stringify(runtimeLogsResponse.body);
    expect(runtimeLogsText).toContain("[info] GET / 200 in 12ms");
    expect(runtimeLogsText).toContain("[warning] Slow request: GET /api/data 200 in 1204ms");
    expect(runtimeLogsText).toContain("HEXCLAVE_SECRET_SERVER_KEY=<redacted>");
    expect(runtimeLogsText).not.toContain(projectKeys.secretServerKey);
  });

  it("rejects runtime logs for services without a successful deployment", async ({ expect }) => {
    await Project.createAndSwitch();
    await niceBackendFetch("/api/v1/deployments/services", {
      method: "POST",
      accessType: "admin",
      body: { id: "quiet" },
    });
    const response = await niceBackendFetch("/api/v1/deployments/services/quiet/runtime-logs", { accessType: "admin" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "This service has not been deployed yet, so there are no runtime logs.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
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

  it("rejects invalid uploads and enforces single use", async ({ expect }) => {
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

    // Upload slot can only be filled once.
    const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "admin" });
    const uploadPath = (uploadResponse.body as any).upload_path.replace("/api/latest/", "/api/v1/");
    const firstPut = await niceBackendFetch(uploadPath, { method: "PUT", accessType: "admin", rawBody: makeSourceTarball() });
    expect(firstPut.status).toBe(200);
    const secondPut = await niceBackendFetch(uploadPath, { method: "PUT", accessType: "admin", rawBody: makeSourceTarball() });
    expect(secondPut).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "This upload slot has already been used. Create a new upload slot and try again.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // A non-gzip upload is rejected at deploy time with a clean 400.
    const badUploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "admin" });
    const badUploadPath = (badUploadResponse.body as any).upload_path.replace("/api/latest/", "/api/v1/");
    await niceBackendFetch(badUploadPath, { method: "PUT", accessType: "admin", rawBody: new TextEncoder().encode("definitely not a gzip stream") });
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
      body: { upload_id: (uploadResponse.body as any).id },
    });
    expect(deployResponse.status).toBe(200);
    const replayResponse = await niceBackendFetch("/api/v1/deployments/services/api/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: (uploadResponse.body as any).id },
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

    // Deploy so the service gets provisioned; the definition domain is synced
    // to the target and Vercel's verification state takes over.
    const uploadResponse = await niceBackendFetch("/api/v1/deployments/uploads", { method: "POST", accessType: "admin" });
    await niceBackendFetch((uploadResponse.body as any).upload_path.replace("/api/latest/", "/api/v1/"), {
      method: "PUT",
      accessType: "admin",
      rawBody: makeSourceTarball(),
    });
    await niceBackendFetch("/api/v1/deployments/services/web/deploy", {
      method: "POST",
      accessType: "admin",
      body: { upload_id: (uploadResponse.body as any).id },
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
