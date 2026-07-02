import { describe, expect, it } from "vitest";
import { parseOwnPackage } from "./own-package.js";

describe("parseOwnPackage", () => {
  it("parses name and version", () => {
    expect(parseOwnPackage({ name: "@hexclave/cli", version: "1.2.3" })).toEqual({
      name: "@hexclave/cli",
      version: "1.2.3",
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
