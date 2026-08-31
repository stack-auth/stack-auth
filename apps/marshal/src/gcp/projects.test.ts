import { afterEach, describe, expect, it, vi } from "vitest";
import { GcpApiError, GcpClient } from "./client.js";
import { projectIdForNamespace, resetTenantProjectCacheForTests, TenantProjectManager } from "./projects.js";

afterEach(() => {
  resetTenantProjectCacheForTests();
  vi.restoreAllMocks();
});

describe("tenant project lifecycle", () => {
  it("derives stable globally safe project ids without exposing the namespace", () => {
    const config = { envId: "production", projectPrefix: "hxc-tenant" };
    const first = projectIdForNamespace(config, "customer_name");
    expect(first).toMatch(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
    expect(first).not.toContain("customer");
    expect(projectIdForNamespace(config, "customer_name")).toBe(first);
    expect(projectIdForNamespace(config, "another_customer")).not.toBe(first);
    expect(projectIdForNamespace({ envId: "test", projectPrefix: "123" }, "customer_name")).toMatch(/^h123-/);
  });

  it("creates, bills, enables, and grants only runtime service identities", async () => {
    const client = new GcpClient();
    const request = vi.spyOn(client, "request")
      .mockResolvedValueOnce({ projects: [] })
      .mockResolvedValueOnce({ name: "operations/create" })
      .mockResolvedValueOnce({ name: "operations/create", done: true })
      .mockResolvedValueOnce({ name: "projects/123456789", projectId: "hxc-test-project", state: "ACTIVE" })
      .mockRejectedValueOnce(new GcpApiError(400, "/v1/projects/hxc-test-project/billingInfo", "Precondition check failed."))
      .mockResolvedValueOnce({ billingEnabled: true })
      .mockResolvedValueOnce({ name: "operations/services" })
      .mockResolvedValueOnce({ name: "operations/services", done: true })
      .mockResolvedValueOnce({ name: "operations/finished.DONE_OPERATION" })
      .mockResolvedValueOnce({
        version: 3,
        etag: "etag",
        bindings: [
          { role: "roles/viewer", members: ["user:operator@example.com"] },
          { role: "roles/editor", members: ["serviceAccount:123456789-compute@developer.gserviceaccount.com", "user:legacy-admin@example.com"] },
        ],
      })
      .mockResolvedValueOnce({ version: 3 });
    const manager = new TenantProjectManager(client, {
      envId: "test",
      billingAccount: "000000-111111-222222",
      parent: "folders/123",
      projectPrefix: "hxc-test",
    });

    const project = await manager.ensureForNamespace("tenant");

    expect(project.projectNumber).toBe("123456789");
    expect(request.mock.calls[0]?.[0]).toContain("projects:search?query=id%3A");
    const createCall = request.mock.calls.find(([url]) => url.endsWith("/v3/projects"));
    expect(createCall?.[1]?.body).toMatchObject({ displayName: "Hexclave tenant tenant" });
    expect("Hexclave tenant tenant".length).toBeLessThanOrEqual(30);
    expect(request.mock.calls.some(([url]) => url.includes("services:batchEnable"))).toBe(true);
    const setPolicyCall = request.mock.calls.find(([url]) => url.includes(":setIamPolicy"));
    expect(setPolicyCall?.[1]?.body).toMatchInlineSnapshot(`
      {
        "policy": {
          "bindings": [
            {
              "members": [
                "user:operator@example.com",
              ],
              "role": "roles/viewer",
            },
            {
              "members": [
                "user:legacy-admin@example.com",
              ],
              "role": "roles/editor",
            },
            {
              "members": [
                "serviceAccount:123456789-compute@developer.gserviceaccount.com",
              ],
              "role": "roles/artifactregistry.writer",
            },
            {
              "members": [
                "serviceAccount:123456789-compute@developer.gserviceaccount.com",
              ],
              "role": "roles/logging.logWriter",
            },
            {
              "members": [
                "serviceAccount:service-123456789@serverless-robot-prod.iam.gserviceaccount.com",
              ],
              "role": "roles/compute.networkUser",
            },
          ],
          "etag": "etag",
          "version": 3,
        },
      }
    `);
  });

  it("refuses to delete a project outside the configured disposable prefix", async () => {
    const client = new GcpClient();
    const request = vi.spyOn(client, "request");
    const manager = new TenantProjectManager(client, {
      envId: "test",
      billingAccount: "unused",
      parent: null,
      projectPrefix: "hxc-test",
    });
    await expect(manager.deleteDisposableProject("production-project")).rejects.toThrow("outside Marshal's configured project prefix");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not issue a permission-hidden delete when the disposable project is absent", async () => {
    const client = new GcpClient();
    const request = vi.spyOn(client, "request")
      .mockRejectedValueOnce(new GcpApiError(403, "/v3/projects/hxc-test-absent", "permission denied"))
      .mockResolvedValueOnce({ projects: [] });
    const manager = new TenantProjectManager(client, {
      envId: "test",
      billingAccount: "unused",
      parent: null,
      projectPrefix: "hxc-test",
    });

    await manager.deleteDisposableProject("hxc-test-absent");

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(request.mock.calls[1]?.[0]).toContain("projects:search?query=id%3Ahxc-test-absent");
  });
});
