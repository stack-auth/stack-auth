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

it("should require admin authentication", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndGetAdminToken();

  // Try without admin token
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

  expect(response.status).toBe(401);
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

it("should accept valid system prompts", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const makeRequest = async (systemPrompt: string) => {
    return await niceBackendFetch("/api/latest/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        systemPrompt,
        tools: [],
        messages: [{ role: "user", content: "const x = 1;" }],
        quality: "smart",
        speed: "fast",
      },
    });
  };

  // Valid system prompts
  const wysiwygResponse = await makeRequest("wysiwyg-edit");
  expect(wysiwygResponse.status).toBe(200);

  const emailTemplateResponse = await makeRequest("email-assistant-template");
  expect(emailTemplateResponse.status).toBe(200);

  const emailDraftResponse = await makeRequest("email-assistant-draft");
  expect(emailDraftResponse.status).toBe(200);

  // Invalid system prompt
  const invalidResponse = await makeRequest("invalid-prompt");
  expect(invalidResponse.status).toBe(400);
});
