import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

// Tests for the WYSIWYG edit endpoint
// Note: These tests require an AI provider to be configured in the environment

it("should return the original source when old_text equals new_text", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const sourceCode = `
    export function EmailTemplate() {
      return <div>Hello World!</div>;
    }
  `;

  const response = await niceBackendFetch("/api/v1/internal/wysiwyg-edit", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      source_type: "template",
      source_code: sourceCode,
      old_text: "Hello World!",
      new_text: "Hello World!", // Same as old_text
      metadata: {
        id: "e0",
        loc: { start: 50, end: 62, line: 3, column: 18 },
        originalText: "Hello World!",
        textHash: "abc123",
        jsxPath: ["EmailTemplate", "div"],
        parentElement: { tagName: "div", props: {} },
        sourceContext: { before: "", after: "" },
        siblingIndex: 0,
        occurrenceCount: 1,
        occurrenceIndex: 1,
        sourceFile: "template",
      },
      dom_path: [{ tag_name: "DIV", index: 0 }],
      html_context: "<div>Hello World!</div>",
    },
  });

  expect(response.status).toBe(200);
  expect(response.body.updated_source).toBe(sourceCode);
});

it("should require admin authentication", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Try without admin token
  const response = await niceBackendFetch("/api/v1/internal/wysiwyg-edit", {
    method: "POST",
    accessType: "client",
    body: {
      source_type: "template",
      source_code: "const x = 1;",
      old_text: "1",
      new_text: "2",
      metadata: {
        id: "e0",
        loc: { start: 10, end: 11, line: 1, column: 10 },
        originalText: "1",
        textHash: "abc123",
        jsxPath: [],
        parentElement: { tagName: "div", props: {} },
        sourceContext: { before: "", after: "" },
        siblingIndex: 0,
        occurrenceCount: 1,
        occurrenceIndex: 1,
        sourceFile: "template",
      },
      dom_path: [],
      html_context: "",
    },
  });

  expect(response.status).toBe(401);
});

it("should validate required fields in metadata", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch("/api/v1/internal/wysiwyg-edit", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      source_type: "template",
      source_code: "const x = 1;",
      old_text: "1",
      new_text: "2",
      metadata: {
        // Missing required fields
        id: "e0",
      },
      dom_path: [],
      html_context: "",
    },
  });

  expect(response.status).toBe(400);
});

it("should accept valid source_type values", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const makeRequest = async (sourceType: string) => {
    return await niceBackendFetch("/api/v1/internal/wysiwyg-edit", {
      method: "POST",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        source_type: sourceType,
        source_code: "const x = 1;",
        old_text: "1",
        new_text: "1", // Same, so no AI call needed
        metadata: {
          id: "e0",
          loc: { start: 10, end: 11, line: 1, column: 10 },
          originalText: "1",
          textHash: "abc123",
          jsxPath: [],
          parentElement: { tagName: "div", props: {} },
          sourceContext: { before: "", after: "" },
          siblingIndex: 0,
          occurrenceCount: 1,
          occurrenceIndex: 1,
          sourceFile: "template",
        },
        dom_path: [],
        html_context: "",
      },
    });
  };

  // Valid source types
  const templateResponse = await makeRequest("template");
  expect(templateResponse.status).toBe(200);

  const themeResponse = await makeRequest("theme");
  expect(themeResponse.status).toBe(200);

  const draftResponse = await makeRequest("draft");
  expect(draftResponse.status).toBe(200);

  // Invalid source type
  const invalidResponse = await makeRequest("invalid");
  expect(invalidResponse.status).toBe(400);
});
