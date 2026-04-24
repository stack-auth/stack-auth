import { it } from "../../../../../helpers";
import { AiChatReviewer, niceBackendFetch } from "../../../../backend-helpers";

// Every mcp-review endpoint shares the same auth gate (isAiChatReviewer metadata check)
// and the same short-circuit order: auth → metadata → yup → reducer. Tests here cover
// the first three.
const endpoints = [
  {
    path: "/api/latest/internal/mcp-review/mark-reviewed",
    validBody: { correlationId: "abc123" },
    invalidBody: {},
  },
  {
    path: "/api/latest/internal/mcp-review/unmark-reviewed",
    validBody: { correlationId: "abc123" },
    invalidBody: {},
  },
  {
    path: "/api/latest/internal/mcp-review/update-correction",
    validBody: {
      correlationId: "abc123",
      correctedQuestion: "q",
      correctedAnswer: "a",
      publish: false,
    },
    invalidBody: { correlationId: "abc123", publish: "yes" as unknown as boolean },
  },
  {
    path: "/api/latest/internal/mcp-review/add-manual",
    validBody: { question: "q", answer: "a", publish: false },
    invalidBody: { question: "q" },
  },
  {
    path: "/api/latest/internal/mcp-review/delete",
    validBody: { correlationId: "abc123" },
    invalidBody: {},
  },
] as const;

for (const { path, validBody, invalidBody } of endpoints) {
  it(`${path}: rejects unauthenticated requests`, async ({ expect }) => {
    const response = await niceBackendFetch(path, {
      method: "POST",
      accessType: "client",
      body: validBody,
    });
    // yup schema on createSmartRouteHandler requires auth.user; missing auth fails
    // shape validation as 400 before reaching the handler's auth-specific error path.
    expect([400, 401]).toContain(response.status);
  });

  it(`${path}: rejects a signed-in user without isAiChatReviewer metadata`, async ({ expect }) => {
    await AiChatReviewer.createNonReviewer();
    const response = await niceBackendFetch(path, {
      method: "POST",
      accessType: "client",
      body: validBody,
    });
    expect(response.status).toBe(403);
    expect(String(response.body)).toContain("not approved to perform MCP review operations");
  });

  it(`${path}: rejects a reviewer sending an invalid body`, async ({ expect }) => {
    await AiChatReviewer.createReviewer();
    const response = await niceBackendFetch(path, {
      method: "POST",
      accessType: "client",
      body: invalidBody,
    });
    expect(response.status).toBe(400);
  });
}
