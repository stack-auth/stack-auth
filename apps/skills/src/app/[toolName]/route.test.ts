import { describe, expect, it, vi } from "vitest";

import { HEAD } from "./route";

describe("skill-site MCP tool route", () => {
  it("does not call MCP tools for HEAD requests but validates the route", async () => {
    const previousFetch = globalThis.fetch;
    const previousHexclaveMcpBaseUrl = process.env.HEXCLAVE_MCP_BASE_URL;
    process.env.HEXCLAVE_MCP_BASE_URL = "https://mcp.hexclave.com/mcp";

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      expect(body?.method).toBe("tools/list");

      return new Response(`data: ${JSON.stringify({
        result: {
          tools: [{ name: "ask_hexclave", inputSchema: null }],
        },
        jsonrpc: "2.0",
        id: 1,
      })}`);
    });

    globalThis.fetch = fetchMock;

    try {
      const found = await HEAD(new Request("https://skill.hexclave.com/ask", { method: "HEAD" }));
      expect(found.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockClear();
      const notFound = await HEAD(new Request("https://skill.hexclave.com/nonexistent", { method: "HEAD" }));
      expect(notFound.status).toBe(404);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousHexclaveMcpBaseUrl == null) {
        delete process.env.HEXCLAVE_MCP_BASE_URL;
      } else {
        process.env.HEXCLAVE_MCP_BASE_URL = previousHexclaveMcpBaseUrl;
      }
    }
  });
});
