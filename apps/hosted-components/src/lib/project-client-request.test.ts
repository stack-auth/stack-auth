import { describe, expect, it } from "vitest";
import { getProjectClientRequestHeaders } from "./project-client-request";

describe("getProjectClientRequestHeaders", () => {
  it("includes the project client authentication headers required by API routes", async () => {
    await expect(getProjectClientRequestHeaders({
      projectId: "internal",
      getAccessToken: async () => "access-token",
    })).resolves.toEqual({
      "x-stack-access-type": "client",
      "x-stack-project-id": "internal",
      "x-stack-access-token": "access-token",
    });
  });

  it("rejects when the signed-in session has no access token", async () => {
    await expect(getProjectClientRequestHeaders({
      projectId: "internal",
      getAccessToken: async () => null,
    })).rejects.toThrow("Your session expired. Please sign in again.");
  });
});
