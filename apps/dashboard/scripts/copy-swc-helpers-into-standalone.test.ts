import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySwcHelpersIntoStandalone } from "./copy-swc-helpers-into-standalone.mjs";

describe("copySwcHelpersIntoStandalone", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir != null) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("copies the ESM helper that next@16.3.1's standalone tracer omits", () => {
    tempDir = mkdtempSync(join(tmpdir(), "copy-swc-helpers-"));
    const specifier = "@swc+helpers@0.5.23";
    const standalonePkg = join(tempDir, "standalone", "node_modules", ".pnpm", specifier, "node_modules", "@swc", "helpers");
    const repoPkg = join(tempDir, "repo-pnpm", specifier, "node_modules", "@swc", "helpers");
    mkdirSync(join(standalonePkg, "cjs"), { recursive: true });
    mkdirSync(join(repoPkg, "esm"), { recursive: true });
    writeFileSync(join(standalonePkg, "package.json"), "{\"name\":\"@swc/helpers\"}\n");
    writeFileSync(join(standalonePkg, "cjs", "index.cjs"), "module.exports = {};\n");
    writeFileSync(join(repoPkg, "package.json"), "{\"name\":\"@swc/helpers\"}\n");
    writeFileSync(join(repoPkg, "esm", "_interop_require_default.js"), "export default {};\n");

    copySwcHelpersIntoStandalone(join(tempDir, "standalone"), join(tempDir, "repo-pnpm"));

    expect(readFileSync(join(standalonePkg, "esm", "_interop_require_default.js"), "utf8")).toBe("export default {};\n");
  });
});
