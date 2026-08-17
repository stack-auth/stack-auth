import { it } from "../../../../../helpers";
import { Project, niceBackendFetch, withInternalProject } from "../../../../backend-helpers";

it("rejects a non-internal project", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch("/api/latest/internal/flush-background-tasks", {
    method: "POST",
    accessType: "admin",
    body: {},
  });

  expect(response.status).toBe(400);
  expect(response.headers.get("x-stack-known-error")).toBe("SCHEMA_ERROR");
});

it("accepts the internal project admin key", async ({ expect }) => {
  const response = await withInternalProject(async () => {
    return await niceBackendFetch("/api/latest/internal/flush-background-tasks", {
      method: "POST",
      accessType: "admin",
      body: {},
    });
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
