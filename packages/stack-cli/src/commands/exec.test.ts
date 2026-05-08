import { describe, expect, it } from "vitest";
import { resolveExecTarget } from "./exec.js";

describe("resolveExecTarget", () => {
  it("defaults to local when --cloud is not passed and the env var is unset", () => {
    expect(resolveExecTarget({}, {})).toBe("local");
  });

  it("treats an empty STACK_EXEC_DEFAULT_TARGET as unset", () => {
    expect(resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "" })).toBe("local");
  });

  it("respects STACK_EXEC_DEFAULT_TARGET=cloud", () => {
    expect(resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "cloud" })).toBe("cloud");
  });

  it("respects STACK_EXEC_DEFAULT_TARGET=local explicitly", () => {
    expect(resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "local" })).toBe("local");
  });

  it("--cloud wins even when STACK_EXEC_DEFAULT_TARGET=local", () => {
    expect(resolveExecTarget({ cloud: true }, { STACK_EXEC_DEFAULT_TARGET: "local" })).toBe("cloud");
  });

  it("--cloud wins when the env var is unset", () => {
    expect(resolveExecTarget({ cloud: true }, {})).toBe("cloud");
  });

  it("rejects unknown STACK_EXEC_DEFAULT_TARGET values", () => {
    expect(() => resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "Cloud" })).toThrow(/Invalid STACK_EXEC_DEFAULT_TARGET/);
    expect(() => resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "remote" })).toThrow(/Invalid STACK_EXEC_DEFAULT_TARGET/);
    expect(() => resolveExecTarget({}, { STACK_EXEC_DEFAULT_TARGET: "1" })).toThrow(/Invalid STACK_EXEC_DEFAULT_TARGET/);
  });

  it("does not validate the env var when --cloud short-circuits", () => {
    // --cloud is explicit, so we don't bother surfacing a typo in the env var.
    // This is intentional: an invalid value shouldn't block the explicit flag.
    expect(resolveExecTarget({ cloud: true }, { STACK_EXEC_DEFAULT_TARGET: "garbage" })).toBe("cloud");
  });
});
