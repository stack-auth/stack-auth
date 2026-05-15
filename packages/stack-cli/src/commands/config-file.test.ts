import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigFilePathForPull } from "./config-file.js";

describe("resolveConfigFilePathForPull", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-cli-config-pull-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the resolved --config-file path when provided", () => {
    const explicit = path.join(tmpDir, "nested", "config.ts");
    expect(resolveConfigFilePathForPull({ configFile: explicit }, tmpDir)).toBe(path.resolve(explicit));
  });

  it("rejects an explicit --config-file path that points to a directory", () => {
    expect(() => resolveConfigFilePathForPull({ configFile: tmpDir }, tmpDir)).toThrow(/must point to a config file/);
  });

  it("falls back to ./stack.config.ts in cwd when --config-file is omitted", () => {
    const expected = path.join(tmpDir, "stack.config.ts");
    fs.writeFileSync(expected, "// placeholder\n");
    expect(resolveConfigFilePathForPull({}, tmpDir)).toBe(expected);
  });

  it("rejects the default ./stack.config.ts path when it is a directory", () => {
    fs.mkdirSync(path.join(tmpDir, "stack.config.ts"));
    expect(() => resolveConfigFilePathForPull({}, tmpDir)).toThrow(/directory instead of a file/);
  });

  it("treats an empty --config-file string as omitted (falls back to cwd)", () => {
    const expected = path.join(tmpDir, "stack.config.ts");
    fs.writeFileSync(expected, "// placeholder\n");
    expect(resolveConfigFilePathForPull({ configFile: "" }, tmpDir)).toBe(expected);
  });

  it("throws a CliError with help text when neither --config-file nor cwd stack.config.ts exists", () => {
    expect(() => resolveConfigFilePathForPull({}, tmpDir)).toThrow(/Pass --config-file/);
  });
});
