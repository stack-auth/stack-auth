import { describe, expect, it } from "vitest";
import { parseExecTarget } from "./exec.js";

describe("parseExecTarget", () => {
  it("returns a cloud target when --cloud-project-id is set", () => {
    expect(parseExecTarget({ cloudProjectId: "proj_123" })).toEqual({ kind: "cloud", projectId: "proj_123" });
  });

  it("returns a config target when --config-file is set", () => {
    expect(parseExecTarget({ configFile: "./stack.config.ts" })).toEqual({ kind: "config", configFile: "./stack.config.ts" });
  });

  it("rejects passing both --cloud-project-id and --config-file", () => {
    expect(() => parseExecTarget({ cloudProjectId: "proj_123", configFile: "./stack.config.ts" })).toThrow(/not both/);
  });

  it("rejects passing neither", () => {
    expect(() => parseExecTarget({})).toThrow(/Specify a target/);
  });

  it("treats an empty --cloud-project-id as absent", () => {
    expect(() => parseExecTarget({ cloudProjectId: "" })).toThrow(/Specify a target/);
  });

  it("treats an empty --config-file as absent", () => {
    expect(() => parseExecTarget({ configFile: "" })).toThrow(/Specify a target/);
  });
});
