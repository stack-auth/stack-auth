import { describe, expect, it, vi } from "vitest";

import { HEAD } from "./route";

describe("skill-site MCP tool route", () => {
  it("does not call MCP tools for HEAD requests", () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    try {
      const response = HEAD();

      expect(response.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
