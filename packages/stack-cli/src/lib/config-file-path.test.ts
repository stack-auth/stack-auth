import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigFilePathOption } from "./config-file-path.js";

describe("resolveConfigFilePathOption", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-cli-config-file-path-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a resolved existing file path", () => {
    const configFile = path.join(tmpDir, "stack.config.ts");
    fs.writeFileSync(configFile, "// config\n");

    expect(resolveConfigFilePathOption(configFile, { mustExist: true })).toBe(configFile);
  });

  it("rejects an existing directory", () => {
    expect(() => resolveConfigFilePathOption(tmpDir, { mustExist: true })).toThrow(/must point to a config file, but got a directory/);
  });

  it("allows a missing file path when mustExist is not set", () => {
    const configFile = path.join(tmpDir, "missing.config.ts");

    expect(resolveConfigFilePathOption(configFile)).toBe(configFile);
  });

  it("rejects a missing file path when mustExist is set", () => {
    const configFile = path.join(tmpDir, "missing.config.ts");

    expect(() => resolveConfigFilePathOption(configFile, { mustExist: true })).toThrow(/Config file not found/);
  });
});
