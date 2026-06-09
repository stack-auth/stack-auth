import { describe, expect, it } from "vitest";

import { buildMcpToolArguments, getAvailableRouteNames, getMcpEndpointUrl, resolveMcpToolRoute } from "./mcp-wrapper";

function restoreEnvVariable(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("skill-site MCP wrapper", () => {
  const askTool = {
    name: "ask_hexclave",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        reason: { type: "string" },
        userPrompt: { type: "string" },
        conversationId: { type: "string" },
      },
      required: ["question", "reason", "userPrompt"],
    },
  };

  it("resolves exact tool names and public Hexclave aliases", () => {
    const tools = [
      askTool,
      { name: "inspect_project", inputSchema: null },
    ];

    expect(resolveMcpToolRoute(tools, "ask_hexclave")?.name).toBe("ask_hexclave");
    expect(resolveMcpToolRoute(tools, "ask")?.name).toBe("ask_hexclave");
    expect(resolveMcpToolRoute(tools, "inspect_project")?.name).toBe("inspect_project");
    expect(resolveMcpToolRoute(tools, "missing")).toBeNull();
    expect(getAvailableRouteNames(tools)).toMatchInlineSnapshot(`
      [
        "ask",
        "ask_hexclave",
        "inspect_project",
      ]
    `);
  });

  it("maps query to question for the ask route while preserving MCP parameters", () => {
    const params = new URLSearchParams({
      query: "How do I add OAuth?",
      conversationId: "conversation-123",
    });

    expect(buildMcpToolArguments(askTool, params)).toMatchInlineSnapshot(`
      {
        "conversationId": "conversation-123",
        "question": "How do I add OAuth?",
        "reason": "skill-site MCP tool route",
        "userPrompt": "How do I add OAuth?",
      }
    `);
  });

  it("preserves explicit ask metadata when the caller provides it", () => {
    const params = new URLSearchParams({
      query: "How do I add OAuth?",
      reason: "User asked about OAuth setup",
      userPrompt: "Original user words",
    });

    expect(buildMcpToolArguments(askTool, params)).toMatchInlineSnapshot(`
      {
        "question": "How do I add OAuth?",
        "reason": "User asked about OAuth setup",
        "userPrompt": "Original user words",
      }
    `);
  });

  it("coerces query values from a tool JSON schema", () => {
    const tool = {
      name: "search",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          includeDrafts: { type: "boolean" },
          filters: { type: "object" },
          tags: { type: "array" },
        },
      },
    };
    const params = new URLSearchParams();
    params.set("limit", "10");
    params.set("includeDrafts", "true");
    params.set("filters", "{\"kind\":\"guide\"}");
    params.append("tags", "sdk");
    params.append("tags", "oauth");

    expect(buildMcpToolArguments(tool, params)).toMatchInlineSnapshot(`
      {
        "filters": {
          "kind": "guide",
        },
        "includeDrafts": true,
        "limit": 10,
        "tags": [
          "sdk",
          "oauth",
        ],
      }
    `);
  });

  it("infers the sibling MCP endpoint from local and production skill URLs", () => {
    const previousHexclaveMcpBaseUrl = process.env.HEXCLAVE_MCP_BASE_URL;
    const previousStackMcpBaseUrl = process.env.STACK_MCP_BASE_URL;
    delete process.env.HEXCLAVE_MCP_BASE_URL;
    delete process.env.STACK_MCP_BASE_URL;

    try {
      expect(getMcpEndpointUrl(new Request("http://localhost:8145/ask")).toString()).toBe("http://localhost:8144/mcp");
      expect(getMcpEndpointUrl(new Request("https://skill.hexclave.com/ask")).toString()).toBe("https://mcp.hexclave.com/mcp");
    } finally {
      restoreEnvVariable("HEXCLAVE_MCP_BASE_URL", previousHexclaveMcpBaseUrl);
      restoreEnvVariable("STACK_MCP_BASE_URL", previousStackMcpBaseUrl);
    }
  });
});
