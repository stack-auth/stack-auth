import { describe, expect, it } from "vitest";

import { assertManagedProject } from "./mcp-projects";

describe("MCP project authorization", () => {
  it("rejects a target project outside the managed project list", () => {
    expect(() => assertManagedProject([
      { id: "owned", display_name: "Owned", description: null },
    ], "not-owned")).toThrow("does not manage");
  });
});
