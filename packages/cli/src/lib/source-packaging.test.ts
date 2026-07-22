import { parseTar } from "@hexclave/shared/dist/utils/tar";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { packageSourceDirectory } from "./source-packaging.js";

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hexclave-package-test-"));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const write = (root: string, relativePath: string, content: string) => {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

const packagedPaths = (root: string) => {
  const packaged = packageSourceDirectory(root);
  const entries = parseTar(gunzipSync(packaged.tarballGzipped), { maxEntries: 10_000, maxTotalBytes: 100 * 1024 * 1024 });
  return entries.map((entry) => entry.path);
};

describe("packageSourceDirectory", () => {
  it("packages files with deterministic ordering and roundtrips content", () => {
    const root = makeTempDir();
    write(root, "package.json", `{"name":"x"}`);
    write(root, "src/index.ts", "export {}\n");
    write(root, "src/a.ts", "// a\n");

    const packaged = packageSourceDirectory(root);
    const entries = parseTar(gunzipSync(packaged.tarballGzipped), { maxEntries: 100, maxTotalBytes: 1024 * 1024 });
    expect(entries.map((entry) => entry.path)).toEqual(["package.json", "src/a.ts", "src/index.ts"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe(`{"name":"x"}`);
    expect(packaged.fileCount).toBe(3);

    // Byte-identical when repackaged (fixed mtimes, sorted entries).
    expect(Buffer.compare(packageSourceDirectory(root).tarballGzipped, packaged.tarballGzipped)).toBe(0);
  });

  it("always drops node_modules and .git, even without ignore files", () => {
    const root = makeTempDir();
    write(root, "index.js", "");
    write(root, "node_modules/pkg/index.js", "");
    write(root, ".git/HEAD", "");
    write(root, "nested/node_modules/pkg/index.js", "");
    expect(packagedPaths(root)).toEqual(["index.js"]);
  });

  it("respects .gitignore and .vercelignore including negation", () => {
    const root = makeTempDir();
    write(root, ".gitignore", "*.log\ndist/\n!keep.log\n");
    write(root, ".vercelignore", "*.md\n");
    write(root, "app.js", "");
    write(root, "error.log", "");
    write(root, "keep.log", "");
    write(root, "README.md", "");
    write(root, "dist/out.js", "");
    expect(packagedPaths(root)).toEqual([".gitignore", ".vercelignore", "app.js", "keep.log"]);
  });

  it("applies nested .gitignore files relative to their directory", () => {
    const root = makeTempDir();
    write(root, "sub/.gitignore", "local-only.txt\n");
    write(root, "sub/local-only.txt", "");
    write(root, "sub/kept.txt", "");
    write(root, "local-only.txt", "");
    expect(packagedPaths(root)).toEqual(["local-only.txt", "sub/.gitignore", "sub/kept.txt"]);
  });

  it("skips symlinks", () => {
    const root = makeTempDir();
    write(root, "real.txt", "hi");
    fs.symlinkSync(path.join(root, "real.txt"), path.join(root, "link.txt"));
    expect(packagedPaths(root)).toEqual(["real.txt"]);
  });

  it("errors on a missing directory", () => {
    expect(() => packageSourceDirectory(path.join(makeTempDir(), "nope"))).toThrow("Source directory not found");
  });

  it("errors when everything is ignored", () => {
    const root = makeTempDir();
    write(root, "node_modules/pkg/index.js", "");
    expect(() => packageSourceDirectory(root)).toThrow("No files to deploy");
  });
});
