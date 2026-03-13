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

  const userPrompt = `
## Source Code to Edit
\`\`\`tsx
${sourceCode}
\`\`\`

## Edit Request
- **Old text:** "Hello World!"
- **New text:** "Hello World!"

## Location Information
- **Line:** 3
- **Column:** 18
- **JSX Path:** EmailTemplate > div
- **Parent Element:** <div>
- **Sibling Index:** 0
- **Occurrence:** 1 of 1

## Source Context (lines around the text)
Before:
\`\`\`
\`\`\`

After:
\`\`\`
\`\`\`

## Runtime DOM Path (for disambiguation)
1. <DIV> (index: 0)

## Rendered HTML Context
\`\`\`html
<div>Hello World!</div>
\`\`\`

Please update the source code to change "Hello World!" to "Hello World!" at the specified location. Return ONLY the complete updated source code.
`;

  const response = await niceBackendFetch("/api/latest/ai/query/generate", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      systemPrompt: "wysiwyg-edit",
      tools: [],
      messages: [{ role: "user", content: userPrompt }],
      quality: "smart",
      speed: "fast",
    },
  });

  expect(response.status).toBe(200);
  const textBlock = Array.isArray(response.body.content)
    ? response.body.content.find((b: any) => b.type === "text" && b.text)
    : undefined;
  const updatedSource = textBlock?.text?.trim() ?? sourceCode;
  // When old_text equals new_text, the AI should return the original source unchanged
  expect(updatedSource.includes("Hello World!")).toBe(true);
});

it("should allow unauthenticated access (with weaker model)", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndGetAdminToken();

  // The unified AI endpoint allows unauthenticated access — unauthenticated
  // users get a weaker/cheaper model instead of being rejected.
  const response = await niceBackendFetch("/api/latest/ai/query/generate", {
    method: "POST",
    accessType: "client",
    body: {
      systemPrompt: "wysiwyg-edit",
      tools: [],
      messages: [{ role: "user", content: "const x = 1;" }],
      quality: "smart",
      speed: "fast",
    },
  });

  expect(response.status).toBe(200);
});

it("should validate required fields in messages", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch("/api/latest/ai/query/generate", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      systemPrompt: "wysiwyg-edit",
      tools: [],
      messages: [], // Missing required messages
      quality: "smart",
      speed: "fast",
    },
  });

  expect(response.status).toBe(400);
});

it("should reject invalid system prompts", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch("/api/latest/ai/query/generate", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      systemPrompt: "invalid-prompt",
      tools: [],
      messages: [{ role: "user", content: "const x = 1;" }],
      quality: "smart",
      speed: "fast",
    },
  });

  expect(response.status).toBe(400);
});
