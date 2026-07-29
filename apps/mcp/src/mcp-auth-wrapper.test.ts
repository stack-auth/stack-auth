import { withMcpAuth } from "@vercel/mcp-adapter";
import { describe, expect, it } from "vitest";

describe("MCP optional authentication", () => {
  it("allows the public docs handler through without a bearer token", async () => {
    const handler = withMcpAuth(
      () => Response.json({ ok: true }),
      async () => undefined,
      { required: false },
    );

    const response = await handler(new Request("https://mcp.example.com/mcp", { method: "GET" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects an invalid token instead of treating it as anonymous", async () => {
    const handler = withMcpAuth(
      () => Response.json({ ok: true }),
      async () => {
        throw new Error("wrong resource");
      },
      { required: false },
    );

    const response = await handler(new Request("https://mcp.example.com/mcp", {
      headers: { Authorization: "Bearer invalid" },
    }));

    expect(response.status).toBe(401);
  });
});
