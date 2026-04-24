import { it } from "../../../../../helpers";
import { AiChatReviewer, niceBackendFetch } from "../../../../backend-helpers";

const VALID_HEX = "a".repeat(64);

it("rejects unauthenticated requests", async ({ expect }) => {
  const response = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
    method: "POST",
    accessType: "client",
    body: { identity: VALID_HEX },
  });
  // createSmartRouteHandler's yup schema requires auth.user; missing auth trips
  // schema validation before the handler runs, so this comes back as 400, not 401.
  expect([400, 401]).toContain(response.status);
});

it("rejects a signed-in user without isAiChatReviewer metadata", async ({ expect }) => {
  await AiChatReviewer.createNonReviewer();
  const response = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
    method: "POST",
    accessType: "client",
    body: { identity: VALID_HEX },
  });
  expect(response.status).toBe(403);
  expect(String(response.body)).toContain("not approved to perform MCP review operations");
});

it("rejects a reviewer sending a non-hex identity", async ({ expect }) => {
  await AiChatReviewer.createReviewer();
  const response = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
    method: "POST",
    accessType: "client",
    body: { identity: "not-a-hex-identity" },
  });
  expect(response.status).toBe(400);
  expect(String(response.body)).toContain("Invalid identity");
});

it("rejects a reviewer sending a hex identity of the wrong length", async ({ expect }) => {
  await AiChatReviewer.createReviewer();
  const response = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
    method: "POST",
    accessType: "client",
    body: { identity: "a".repeat(63) },
  });
  expect(response.status).toBe(400);
  expect(String(response.body)).toContain("Invalid identity");
});

it("rejects a reviewer sending a request without an identity field", async ({ expect }) => {
  await AiChatReviewer.createReviewer();
  const response = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
    method: "POST",
    accessType: "client",
    body: {},
  });
  expect(response.status).toBe(400);
});
