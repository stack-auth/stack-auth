import { describe, expect, it } from "vitest";
import { getTools } from ".";
import { readConfigTool } from "./read-config";

describe("readConfigTool", () => {
  it("does not create a config tool without a resolvable project target", () => {
    expect(readConfigTool(null, null)).toBeNull();
    expect(readConfigTool(null, undefined)).toBeNull();
  });

  it("creates a config tool for an explicit project target", () => {
    expect(readConfigTool(null, "00000000-0000-0000-0000-000000000000")).not.toBeNull();
  });
});

describe("getTools", () => {
  it("omits readBranchConfig when read-config has no resolvable project target", async () => {
    await expect(getTools(["read-config"], {
      auth: null,
      targetProjectId: null,
    })).resolves.toEqual({});
  });

  it("includes readBranchConfig when read-config has an explicit project target", async () => {
    const tools = await getTools(["read-config"], {
      auth: null,
      targetProjectId: "00000000-0000-0000-0000-000000000000",
    });

    expect(tools).toHaveProperty("readBranchConfig");
  });
});
