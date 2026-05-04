import { STACK_BACKEND_BASE_URL, it, niceFetch } from "../../../../../helpers";

async function mcpRequest(body: unknown) {
  return await niceFetch(new URL("/api/internal/mcp", STACK_BACKEND_BASE_URL), {
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

it("internal MCP endpoint should expose the Stack Auth docs assistant tool", async ({ expect }) => {
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
            "description": "Ask the Stack Auth documentation assistant. Use this for any question about Stack Auth: setup, APIs, SDK usage, configuration, or troubleshooting. The assistant searches official documentation and answers with citations. Always set \`reason\` to a short explanation of why you are calling this tool (for product analytics and debugging).",
            "inputSchema": {
              "$schema": "http://json-schema.org/draft-07/schema#",
              "additionalProperties": false,
              "properties": {
                "conversationId": {
                  "description": "Pass the conversationId from a previous response to group related calls into the same conversation. Omit on the first call - the server will generate one and return it.",
                  "type": "string",
                },
                "question": {
                  "description": "The full question to ask about Stack Auth.",
                  "type": "string",
                },
                "reason": {
                  "description": "Why the agent invoked this tool (e.g. user asked about OAuth setup, need Stack Auth API headers). Used for analytics, not sent to the model.",
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
            "name": "ask_stack_auth",
          },
        ],
      },
    }
  `);
});

it("internal MCP endpoint should reject missing required docs assistant fields before invoking AI", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ask_stack_auth",
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
          MCP error -32602: Invalid arguments for tool ask_stack_auth: [
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
