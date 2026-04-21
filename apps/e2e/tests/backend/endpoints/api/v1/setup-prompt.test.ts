import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";

it("returns the SDK setup prompt as text with short cache headers", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/setup-prompt");

  expect(response.status).toBe(200);
  expect(typeof response.body).toBe("string");
  expect(response.body).toContain("# Setting up Stack Auth");
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
});
