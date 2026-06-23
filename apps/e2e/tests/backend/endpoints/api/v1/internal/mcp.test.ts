import { STACK_MCP_BASE_URL, it, niceFetch } from "../../../../../helpers";

async function mcpRequest(body: unknown, path = "/api/internal/mcp") {
  return await niceFetch(new URL(path, STACK_MCP_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

function parseMcpBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  const dataLine = body
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (dataLine == null) {
    return JSON.parse(body);
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

it("internal MCP endpoint should expose the Hexclave docs assistant tool", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  expect(response.status).toBe(200);
  expect(parseMcpBody(response.body)).toMatchInlineSnapshot(`
    {
      "id": 1,
      "jsonrpc": "2.0",
      "result": {
        "tools": [
          {
            "description": "Ask the Hexclave documentation assistant. Use this for any question about Hexclave: setup, APIs, SDK usage, configuration, or troubleshooting. The assistant searches official documentation and answers with citations. Always set \`reason\` to a short explanation of why you are calling this tool (for product analytics and debugging).",
            "inputSchema": {
              "$schema": "http://json-schema.org/draft-07/schema#",
              "additionalProperties": false,
              "properties": {
                "conversationId": {
                  "description": "Pass the conversationId from a previous response to group related calls into the same conversation. Omit on the first call - the server will generate one and return it.",
                  "type": "string",
                },
                "question": {
                  "description": "The full question to ask about Hexclave.",
                  "type": "string",
                },
                "reason": {
                  "description": "Why the agent invoked this tool (e.g. user asked about OAuth setup, need Hexclave API headers). Used for analytics, not sent to the model.",
                  "minLength": 1,
                  "type": "string",
                },
                "userPrompt": {
                  "description": "The original user message/prompt that triggered this tool call. Copy the user's exact words. Don't include any sensitive information.",
                  "minLength": 1,
                  "type": "string",
                },
              },
              "required": [
                "question",
                "reason",
                "userPrompt",
              ],
              "type": "object",
            },
            "name": "ask_hexclave",
          },
        ],
      },
    }
  `);
});

it("public MCP endpoint should expose the Hexclave docs assistant tool", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  }, "/mcp");

  expect(response.status).toBe(200);
  expect(parseMcpBody(response.body)).toMatchObject({
    result: {
      tools: [
        {
          name: "ask_hexclave",
        },
      ],
    },
  });
});

it("public MCP endpoint should expose prompts and resources without method-not-found errors", async ({ expect }) => {
  const promptsResponse = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/list",
  }, "/mcp");

  expect(promptsResponse.status).toBe(200);
  expect(parseMcpBody(promptsResponse.body)).toMatchObject({
    result: {
      prompts: [
        {
          name: "skill",
        },
      ],
    },
  });

  const resourcesResponse = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/list",
  }, "/mcp");

  expect(resourcesResponse.status).toBe(200);
  expect(parseMcpBody(resourcesResponse.body)).toMatchObject({
    result: {
      resources: [
        {
          uri: "https://skill.hexclave.com/full",
          name: "skill",
        },
      ],
    },
  });
});

it("MCP service root should redirect GET and POST to /mcp", async ({ expect }) => {
  const response = await niceFetch(new URL("/", STACK_MCP_BASE_URL), {
    method: "GET",
    redirect: "manual",
  });

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("/mcp");

  const postResponse = await niceFetch(new URL("/", STACK_MCP_BASE_URL), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  expect(postResponse.status).toBe(307);
  expect(postResponse.headers.get("location")).toBe("/mcp");
});

it("MCP setup page should show client installation instructions", async ({ expect }) => {
  const mcpUrl = new URL("/mcp", STACK_MCP_BASE_URL).toString();
  const response = await niceFetch(new URL("/mcp", STACK_MCP_BASE_URL), {
    method: "GET",
    headers: {
      accept: "text/html",
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.body).toContain("Hexclave MCP Setup");
  expect(response.body).toContain("Cursor");
  expect(response.body).toContain("Codex");
  expect(response.body).toContain("Claude Code");
  expect(response.body).toContain("VS Code");
  expect(response.body).toContain(`codex mcp add stack-auth --url ${mcpUrl}`);
  expect(response.body).toContain(mcpUrl);
  expect(response.body).not.toContain("https://mcp.stack-auth.com/mcp");
  expect(response.body).not.toContain("Set up Stack Auth's Model Context Protocol (MCP) server to get intelligent code assistance in your development environment.");
  expect(response.body).toContain("<details class=\"markdown-section\">");
  expect(response.body).not.toContain("<details class=\"markdown-section\" open>");
});

it("internal MCP endpoint should reject missing required docs assistant fields before invoking AI", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ask_hexclave",
      arguments: {
        question: "How do I set up OAuth?",
        userPrompt: "How do I set up OAuth?",
      },
    },
  });

  expect(response.status).toBe(200);
  expect(parseMcpBody(response.body)).toMatchInlineSnapshot(`
    {
      "error": {
        "code": -32602,
        "message": deindent\`
          MCP error -32602: Invalid arguments for tool ask_hexclave: [
            {
              "code": "invalid_type",
              "expected": "string",
              "received": "undefined",
              "path": [
                "reason"
              ],
              "message": "Required"
            }
          ]
        \`,
      },
      "id": 1,
      "jsonrpc": "2.0",
    }
  `);
});
