import { describe, expect, it } from "vitest";
import { parseOwnPackage, resolveBinName } from "./own-package.js";

describe("resolveBinName", () => {
  it("prefers the `hexclave` bin when present (canonical bin across versions)", () => {
    expect(resolveBinName({ stack: "./d.js", hexclave: "./d.js" }, "@hexclave/cli")).toBe("hexclave");
  });

  it("falls back to the first bin key when there is no `hexclave`", () => {
    expect(resolveBinName({ stack: "./d.js" }, "@hexclave/cli")).toBe("stack");
  });

  it("derives the bin from the unscoped package name when bin is absent", () => {
    expect(resolveBinName(undefined, "@hexclave/cli")).toBe("cli");
    expect(resolveBinName(undefined, "hexclave")).toBe("hexclave");
  });

  it("ignores a string `bin` and uses the unscoped package name", () => {
    // npm convention: a string bin's name is the (unscoped) package name.
    expect(resolveBinName("./dist/index.js", "@hexclave/cli")).toBe("cli");
  });
});

describe("parseOwnPackage", () => {
  it("parses name, version, and resolves the bin name", () => {
    expect(parseOwnPackage({ name: "@hexclave/cli", version: "1.2.3", bin: { stack: "./d.js" } })).toEqual({
      name: "@hexclave/cli",
      version: "1.2.3",
      binName: "stack",
    });
  });

  it("returns null when name or version is missing or non-string", () => {
    expect(parseOwnPackage({ version: "1.0.0" })).toBeNull();
    expect(parseOwnPackage({ name: "@hexclave/cli" })).toBeNull();
    expect(parseOwnPackage({ name: 123, version: "1.0.0" })).toBeNull();
    expect(parseOwnPackage({ name: "@hexclave/cli", version: 1 })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseOwnPackage(null)).toBeNull();
    expect(parseOwnPackage("nope")).toBeNull();
    expect(parseOwnPackage(undefined)).toBeNull();
  });
});
