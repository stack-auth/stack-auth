import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareArtifacts, registerSourceMapsCommand } from "../commands/source-maps.js";
import { CliError } from "./errors.js";
import {
  appendDebugIdSnippet,
  collectArtifacts,
  deriveDebugId,
  determineDebugIdFromBundleSource,
  determineSourceMapPathFromBundle,
  findIntegrityManifests,
  findNextBuildRoots,
  normalizeSourcePath,
  prepareSourceMapForUpload,
  readInlineSourceMap,
} from "./source-maps.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const FIXTURE_BUNDLE = fs.readFileSync(path.join(FIXTURES_DIR, "minified-chunk.js"), "utf-8");
const FIXTURE_MAP_TEXT = fs.readFileSync(path.join(FIXTURES_DIR, "minified-chunk.js.map"), "utf-8");

const DEBUG_ID_A = "11111111-2222-4333-8444-555555555555";
const DEBUG_ID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// A minimal source-map reader.
//
// `@jridgewell/trace-mapping` does not resolve from this package and the CLI
// takes zero new dependencies, so the mapping-invariance test — the single most
// important test in this file — decodes the VLQ `mappings` itself. It is a
// direct transcription of the source map spec's decoding rules.
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlqValues(text: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let accumulator = 0;
  for (const character of text) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error(`Invalid base64 VLQ character: ${character}`);
    accumulator += (digit & 31) << shift;
    if ((digit & 32) !== 0) {
      shift += 5;
      continue;
    }
    const isNegative = (accumulator & 1) === 1;
    accumulator >>>= 1;
    values.push(isNegative ? -accumulator : accumulator);
    accumulator = 0;
    shift = 0;
  }
  return values;
}

type MappingSegment = { generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number };

function decodeMappings(mappings: string): MappingSegment[][] {
  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const lineText of mappings.split(";")) {
    let generatedColumn = 0;
    const segments: MappingSegment[] = [];
    for (const segmentText of lineText.split(",")) {
      if (segmentText === "") continue;
      const values = decodeVlqValues(segmentText);
      generatedColumn += values[0];
      if (values.length < 4) continue;
      sourceIndex += values[1];
      originalLine += values[2];
      originalColumn += values[3];
      segments.push({ generatedColumn, sourceIndex, originalLine, originalColumn });
    }
    lines.push(segments);
  }
  return lines;
}

type ResolvedPosition = { source: string, line: number, column: number };

/** `line` is 1-based and `column` 0-based, exactly like the source map spec. */
function originalPositionFor(mapText: string, line: number, column: number): ResolvedPosition | null {
  const map: unknown = JSON.parse(mapText);
  if (typeof map !== "object" || map === null) throw new Error("not a map");
  const mappings = Reflect.get(map, "mappings");
  const sources = Reflect.get(map, "sources");
  if (typeof mappings !== "string" || !Array.isArray(sources)) throw new Error("not a map");
  const segments = decodeMappings(mappings)[line - 1] ?? [];
  let best: MappingSegment | null = null;
  for (const segment of segments) {
    if (segment.generatedColumn > column) break;
    best = segment;
  }
  if (best === null) return null;
  return { source: String(sources[best.sourceIndex]), line: best.originalLine + 1, column: best.originalColumn };
}

function positionOf(source: string, needle: string): { line: number, column: number } {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`needle not found: ${needle}`);
  const before = source.slice(0, index);
  return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
}

// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  // realpath: on macOS os.tmpdir() is a symlink, and the containment checks in
  // determineSourceMapPathFromBundle compare resolved (not realpath'd) strings.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hexclave-sourcemaps-")));
  tempDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relativePath: string, contents: string): string {
  const absolute = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf-8");
  return absolute;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("appendDebugIdSnippet — mapping invariance", () => {
  it("does not shift any mapping: a known position resolves identically before and after injection", () => {
    // The token lives inside the minified code on the first (and only) mapped
    // generated line. If injection shifted lines or columns, resolving it
    // against the UNCHANGED .map would land somewhere else.
    const needle = "greet() requires a name";
    const beforePosition = positionOf(FIXTURE_BUNDLE, needle);
    const beforeResolved = originalPositionFor(FIXTURE_MAP_TEXT, beforePosition.line, beforePosition.column);
    expect(beforeResolved).toEqual({ source: "../src/greeter.ts", line: 3, column: 20 });

    const injected = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);
    expect(injected).not.toBe(FIXTURE_BUNDLE);

    const afterPosition = positionOf(injected, needle);
    expect(afterPosition).toEqual(beforePosition);
    expect(originalPositionFor(FIXTURE_MAP_TEXT, afterPosition.line, afterPosition.column)).toEqual(beforeResolved);
  });

  it("leaves the .map's `mappings` string untouched and puts everything after the last mapped line", () => {
    const map: unknown = JSON.parse(FIXTURE_MAP_TEXT);
    const mappings = Reflect.get(map as object, "mappings");
    const lastMappedLine = decodeMappings(String(mappings)).length;

    const injected = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);
    // Re-preparing the map never rewrites `mappings`.
    const prepared: unknown = JSON.parse(prepareSourceMapForUpload(map, DEBUG_ID_A, { sourceMapDir: FIXTURES_DIR, repoRoot: FIXTURES_DIR }));
    expect(Reflect.get(prepared as object, "mappings")).toBe(mappings);

    const snippetLine = positionOf(injected, "hexclave:debug-id-injection:start").line;
    expect(snippetLine).toBeGreaterThan(lastMappedLine);
  });

  it("keeps the sourceMappingURL comment last", () => {
    const injected = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);
    const lines = injected.split("\n").filter((line) => line !== "");
    expect(lines[lines.length - 1]).toBe("//# sourceMappingURL=minified-chunk.js.map");
  });

  it("appends at EOF when there is no sourceMappingURL comment", () => {
    const source = "console.log(1)";
    const injected = appendDebugIdSnippet(source, DEBUG_ID_A);
    expect(injected.startsWith("console.log(1)\n")).toBe(true);
    expect(determineDebugIdFromBundleSource(injected)).toBe(DEBUG_ID_A);
  });
});

describe("appendDebugIdSnippet — idempotence", () => {
  it("is a no-op the second time with the same id", () => {
    const once = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);
    expect(appendDebugIdSnippet(once, DEBUG_ID_A)).toBe(once);
  });

  it("replaces (never stacks) a previously injected block when the id changes", () => {
    const once = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);
    const twice = appendDebugIdSnippet(once, DEBUG_ID_B);
    expect(determineDebugIdFromBundleSource(twice)).toBe(DEBUG_ID_B);
    expect(twice.includes(DEBUG_ID_A)).toBe(false);
    expect(twice.split("hexclave:debug-id-injection:start").length - 1).toBe(1);
    // And re-injecting the original id restores the original bytes exactly.
    expect(appendDebugIdSnippet(twice, DEBUG_ID_A)).toBe(once);
  });

  it("rejects a malformed debug id rather than writing it into the bundle", () => {
    expect(() => appendDebugIdSnippet(FIXTURE_BUNDLE, "not-a-uuid")).toThrow(CliError);
  });
});

describe("determineDebugIdFromBundleSource", () => {
  it("returns null for an uninjected bundle and the id for an injected one", () => {
    expect(determineDebugIdFromBundleSource(FIXTURE_BUNDLE)).toBeNull();
    expect(determineDebugIdFromBundleSource(appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A))).toBe(DEBUG_ID_A);
  });
});

describe("injected snippet — runtime round trip", () => {
  it("registers the file's own URL as the innermost frame of the stack it records", () => {
    const filename = "https://app.example.com/_next/static/chunks/main-abc123.js";
    const injected = appendDebugIdSnippet(FIXTURE_BUNDLE, DEBUG_ID_A);

    const context: Record<string, unknown> = {};
    vm.createContext(context);
    vm.runInContext(injected, context, { filename });

    const registry = context._hexclaveDebugIds;
    expect(typeof registry).toBe("object");
    expect(context._hexclaveDebugIdIdentifier).toBe(`hexclave-dbid-${DEBUG_ID_A}`);

    const keys = Object.keys(registry as object);
    expect(keys.length).toBe(1);
    expect(Reflect.get(registry as object, keys[0])).toBe(DEBUG_ID_A);

    // The SDK reads this key with `extractInnermostFrameFilename`
    // (packages/template/.../debug-ids.ts, covered by its own vm round trip).
    // It cannot be imported here — the CLI tsconfig's rootDir is `src`, so a
    // cross-package relative import would break `tsc --noEmit` — so the exact
    // property that function depends on is asserted directly instead.
    const innermostFrame = keys[0].split("\n")[1];
    expect(innermostFrame).toMatch(new RegExp(`^\\s+at (?:.*\\()?${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+:\\d+\\)?$`));
  });

  it("survives a hostile global without throwing into the bundle", () => {
    const injected = appendDebugIdSnippet("var ok = 1;", DEBUG_ID_A);
    const context: Record<string, unknown> = {};
    vm.createContext(context);
    // A global whose `_hexclaveDebugIds` slot throws on read (a locked-down
    // environment, or another SDK's Proxy) must not take the bundle down with
    // it — the snippet's try/catch has to swallow it.
    vm.runInContext("Object.defineProperty(globalThis, '_hexclaveDebugIds', { get() { throw new Error('locked down'); } });", context);
    expect(() => vm.runInContext(injected, context, { filename: "/tmp/x.js" })).not.toThrow();
  });
});

describe("determineSourceMapPathFromBundle", () => {
  it("follows the sourceMappingURL comment", () => {
    const dir = makeTempDir();
    const bundlePath = writeFile(dir, "chunks/a.js", "console.log(1)\n//# sourceMappingURL=../maps/a.js.map\n");
    writeFile(dir, "maps/a.js.map", "{}");
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"), { containingDir: dir }))
      .toBe(path.join(dir, "maps/a.js.map"));
  });

  it("falls back to <file>.map when there is no comment", () => {
    const dir = makeTempDir();
    const bundlePath = writeFile(dir, "a.js", "console.log(1)\n");
    writeFile(dir, "a.js.map", "{}");
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"))).toBe(`${bundlePath}.map`);
  });

  it("returns null for an inline data: map instead of picking up a stale <file>.map", () => {
    const dir = makeTempDir();
    const bundlePath = writeFile(dir, "a.js", "console.log(1)\n//# sourceMappingURL=data:application/json;base64,e30=\n");
    writeFile(dir, "a.js.map", "{\"stale\":true}");
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"))).toBeNull();
  });

  it("rejects http(s) sourceMappingURLs", () => {
    const dir = makeTempDir();
    const bundlePath = writeFile(dir, "a.js", "console.log(1)\n//# sourceMappingURL=https://cdn.example.com/a.js.map\n");
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"))).toBeNull();
  });

  it("rejects ../ traversal that escapes the scanned directory", () => {
    const dir = makeTempDir();
    const outside = writeFile(dir, "outside/secret.map", "{}");
    const bundlePath = writeFile(dir, "build/chunks/a.js", "console.log(1)\n//# sourceMappingURL=../../outside/secret.map\n");
    expect(fs.existsSync(outside)).toBe(true);
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"), { containingDir: path.join(dir, "build") })).toBeNull();
  });

  it("rejects an absolute path outside the scanned directory", () => {
    const dir = makeTempDir();
    const outsideDir = makeTempDir();
    const outside = writeFile(outsideDir, "secret.map", "{}");
    const bundlePath = writeFile(dir, "a.js", `console.log(1)\n//# sourceMappingURL=${outside}\n`);
    expect(determineSourceMapPathFromBundle(bundlePath, fs.readFileSync(bundlePath, "utf-8"), { containingDir: dir })).toBeNull();
  });
});

describe("readInlineSourceMap", () => {
  it("decodes base64 and percent-encoded data URIs, and ignores file references", () => {
    const base64 = Buffer.from("{\"version\":3}", "utf-8").toString("base64");
    expect(readInlineSourceMap(`x\n//# sourceMappingURL=data:application/json;base64,${base64}\n`)).toBe("{\"version\":3}");
    expect(readInlineSourceMap("x\n//# sourceMappingURL=data:application/json,%7B%22version%22%3A3%7D\n")).toBe("{\"version\":3}");
    expect(readInlineSourceMap("x\n//# sourceMappingURL=a.js.map\n")).toBeNull();
  });
});

describe("deriveDebugId", () => {
  const minified = Buffer.from("console.log(1)", "utf-8");
  const map = Buffer.from("{\"version\":3,\"mappings\":\"AAAA\"}", "utf-8");

  it("is deterministic for the same (minified, map) pair", () => {
    expect(deriveDebugId(minified, map)).toBe(deriveDebugId(minified, map));
  });

  it("has a UUID shape", () => {
    expect(deriveDebugId(minified, map)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes when only the map changes — byte-identical JS can have different maps", () => {
    const otherMap = Buffer.from("{\"version\":3,\"mappings\":\"AACA\"}", "utf-8");
    expect(deriveDebugId(minified, otherMap)).not.toBe(deriveDebugId(minified, map));
  });

  it("changes when only the minified bytes change", () => {
    expect(deriveDebugId(Buffer.from("console.log(2)", "utf-8"), map)).not.toBe(deriveDebugId(minified, map));
  });
});

describe("prepareSourceMapForUpload", () => {
  const options = { sourceMapDir: "/build/repo/.next/static/chunks", repoRoot: "/build/repo" };

  it("writes both debug_id and debugId", () => {
    const prepared: unknown = JSON.parse(prepareSourceMapForUpload({ version: 3, mappings: "AAAA", sources: [] }, DEBUG_ID_A, options));
    expect(Reflect.get(prepared as object, "debug_id")).toBe(DEBUG_ID_A);
    expect(Reflect.get(prepared as object, "debugId")).toBe(DEBUG_ID_A);
  });

  it("normalizes sources and folds away sourceRoot", () => {
    const prepared: unknown = JSON.parse(prepareSourceMapForUpload({
      version: 3,
      mappings: "AAAA",
      sourceRoot: "/build/repo",
      sources: ["src/app/page.tsx"],
    }, DEBUG_ID_A, options));
    expect(Reflect.get(prepared as object, "sources")).toEqual(["src/app/page.tsx"]);
    expect("sourceRoot" in (prepared as object)).toBe(false);
  });

  it("normalizes the sources of an index map's sections", () => {
    const prepared: unknown = JSON.parse(prepareSourceMapForUpload({
      version: 3,
      sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, mappings: "AAAA", sources: ["webpack://_N_E/./src/a.ts"] } }],
    }, DEBUG_ID_A, options));
    const sections = Reflect.get(prepared as object, "sections");
    expect(Array.isArray(sections)).toBe(true);
    expect(Reflect.get(Reflect.get(sections[0], "map"), "sources")).toEqual(["src/a.ts"]);
  });

  it("rejects something that is not a source map", () => {
    expect(() => prepareSourceMapForUpload({ version: 3 }, DEBUG_ID_A, options)).toThrow(CliError);
    expect(() => prepareSourceMapForUpload("nope", DEBUG_ID_A, options)).toThrow(CliError);
  });
});

describe("normalizeSourcePath", () => {
  const options = { sourceMapDir: "/build/repo/.next/static/chunks", repoRoot: "/build/repo" };

  it("strips bundler protocols and synthetic root segments", () => {
    expect(normalizeSourcePath("webpack://_N_E/./src/app/page.tsx", null, options)).toBe("src/app/page.tsx");
    expect(normalizeSourcePath("webpack-internal:///./src/x.tsx", null, options)).toBe("src/x.tsx");
    expect(normalizeSourcePath("turbopack://[project]/src/y.ts", null, options)).toBe("src/y.ts");
  });

  it("makes build-machine absolute paths repo-relative (this is the privacy fix)", () => {
    expect(normalizeSourcePath("/build/repo/src/lib/a.ts", null, options)).toBe("src/lib/a.ts");
    expect(normalizeSourcePath("file:///build/repo/src/lib/a.ts", null, options)).toBe("src/lib/a.ts");
  });

  it("keeps only the package path for files outside the repo, never the machine layout", () => {
    expect(normalizeSourcePath("/home/runner/.pnpm-store/v3/node_modules/lodash/index.js", null, options)).toBe("node_modules/lodash/index.js");
    expect(normalizeSourcePath("/usr/lib/node/weird.js", null, options)).toBe("weird.js");
  });

  it("collapses ../ segments of map-relative sources", () => {
    expect(normalizeSourcePath("../../../src/app/page.tsx", null, options)).toBe("src/app/page.tsx");
  });
});

describe("collectArtifacts", () => {
  function makeNextBuild(): string {
    const dir = makeTempDir();
    writeFile(dir, ".next/static/chunks/main.js", `${FIXTURE_BUNDLE.split("\n")[0]}\n//# sourceMappingURL=main.js.map\n`);
    writeFile(dir, ".next/static/chunks/main.js.map", FIXTURE_MAP_TEXT);
    writeFile(dir, ".next/static/chunks/nomap.js", "console.log(1)\n");
    writeFile(dir, ".next/server/chunks/9.js", "console.log(9)\n");
    writeFile(dir, ".next/static/chunks/styles.css", "body{}");
    writeFile(dir, ".next/static/node_modules/ignored.js", "console.log('ignored')\n");
    return dir;
  }

  it("finds bundles, resolves their maps, and flags server chunks", () => {
    const dir = makeNextBuild();
    const artifacts = collectArtifacts([path.join(dir, ".next")]);
    const byName = new Map(artifacts.map((artifact) => [path.relative(path.join(dir, ".next"), artifact.bundlePath), artifact]));
    expect([...byName.keys()].sort((a, b) => a < b ? -1 : 1)).toEqual([
      path.join("server", "chunks", "9.js"),
      path.join("static", "chunks", "main.js"),
      path.join("static", "chunks", "nomap.js"),
    ]);
    expect(byName.get(path.join("static", "chunks", "main.js"))?.sourceMapPath).toBe(path.join(dir, ".next/static/chunks/main.js.map"));
    expect(byName.get(path.join("static", "chunks", "nomap.js"))?.sourceMapPath).toBeNull();
    expect(byName.get(path.join("server", "chunks", "9.js"))?.isServerBundle).toBe(true);
    expect(byName.get(path.join("static", "chunks", "main.js"))?.isServerBundle).toBe(false);
  });

  it("de-duplicates overlapping scan directories", () => {
    const dir = makeNextBuild();
    const artifacts = collectArtifacts([path.join(dir, ".next"), path.join(dir, ".next/static")]);
    expect(new Set(artifacts.map((artifact) => artifact.bundlePath)).size).toBe(artifacts.length);
  });

  it("throws on a directory that does not exist", () => {
    expect(() => collectArtifacts([path.join(makeTempDir(), "nope")])).toThrow(CliError);
  });
});

describe("findIntegrityManifests / findNextBuildRoots", () => {
  it("detects integrity hashes in a build manifest (appending would break SRI)", () => {
    const dir = makeTempDir();
    writeFile(dir, ".next/build-manifest.json", JSON.stringify({ pages: { "/": ["static/chunks/main.js"] } }));
    expect(findIntegrityManifests([path.join(dir, ".next")])).toEqual([]);
    writeFile(dir, ".next/app-build-manifest.json", JSON.stringify({ pages: { "/": [{ src: "a.js", integrity: "sha384-abc" }] } }));
    expect(findIntegrityManifests([path.join(dir, ".next")])).toEqual([path.join(dir, ".next/app-build-manifest.json")]);
  });

  it("walks up to the enclosing .next directory", () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, ".next/static/chunks"), { recursive: true });
    expect(findNextBuildRoots([path.join(dir, ".next/static/chunks")])).toEqual([path.join(dir, ".next")]);
    expect(findNextBuildRoots([dir])).toEqual([]);
  });
});

describe("prepareArtifacts (the whole --dry-run path)", () => {
  it("derives ids, prepares maps, and leaves the build output untouched in dry-run", () => {
    const dir = makeTempDir();
    // The fixture's sourceMappingURL names the fixture file; point it at the
    // map we actually write so discovery goes through the comment.
    writeFile(dir, ".next/static/chunks/main.js", FIXTURE_BUNDLE.replace("minified-chunk.js.map", "main.js.map"));
    writeFile(dir, ".next/static/chunks/main.js.map", FIXTURE_MAP_TEXT);
    writeFile(dir, ".next/server/chunks/9.js", "module.exports = 9;\n");

    const candidates = collectArtifacts([path.join(dir, ".next")]);
    const before = fs.readFileSync(path.join(dir, ".next/static/chunks/main.js"), "utf-8");
    const result = prepareArtifacts(candidates, { repoRoot: dir, dryRun: true });

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].debugId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(result.artifacts[0].sourceMapGzipped.length).toBeGreaterThan(0);
    expect(result.artifacts[0].sourceMapSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.serverBundlesWithoutMaps).toEqual([path.join("server", "chunks", "9.js")]);
    expect(fs.readFileSync(path.join(dir, ".next/static/chunks/main.js"), "utf-8")).toBe(before);
  });

  it("writes the snippet once and re-uses the same debug id on a second run", () => {
    const dir = makeTempDir();
    const bundlePath = writeFile(dir, "static/main.js", FIXTURE_BUNDLE.replace("minified-chunk.js.map", "main.js.map"));
    writeFile(dir, "static/main.js.map", FIXTURE_MAP_TEXT);

    const first = prepareArtifacts(collectArtifacts([path.join(dir, "static")]), { repoRoot: dir, dryRun: false });
    const afterFirst = fs.readFileSync(bundlePath, "utf-8");
    expect(determineDebugIdFromBundleSource(afterFirst)).toBe(first.artifacts[0].debugId);

    const second = prepareArtifacts(collectArtifacts([path.join(dir, "static")]), { repoRoot: dir, dryRun: false });
    expect(second.artifacts[0].debugId).toBe(first.artifacts[0].debugId);
    expect(fs.readFileSync(bundlePath, "utf-8")).toBe(afterFirst);
  });
});

describe("hexclave sourcemaps upload — command wiring", () => {
  async function run(argv: string[]): Promise<{ stdout: string, stderr: string }> {
    const program = new Command();
    program.exitOverride();
    registerSourceMapsCommand(program);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void stdout.push(args.join(" ")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void stderr.push(args.join(" ")));
    try {
      await program.parseAsync(["node", "hexclave", ...argv]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  }

  it("runs end to end under --dry-run without auth or network", async () => {
    const dir = makeTempDir();
    writeFile(dir, ".next/static/chunks/main.js", FIXTURE_BUNDLE.replace("minified-chunk.js.map", "main.js.map"));
    writeFile(dir, ".next/static/chunks/main.js.map", FIXTURE_MAP_TEXT);
    writeFile(dir, ".next/server/chunks/9.js", "module.exports = 9;\n");
    const before = fs.readFileSync(path.join(dir, ".next/static/chunks/main.js"), "utf-8");

    const { stdout, stderr } = await run(["sourcemaps", "upload", path.join(dir, ".next"), "--dry-run", "--release", "v1"]);
    const summary: unknown = JSON.parse(stdout);
    expect(Reflect.get(summary as object, "dryRun")).toBe(true);
    expect(Reflect.get(summary as object, "release")).toBe("v1");
    expect(Array.isArray(Reflect.get(summary as object, "artifacts"))).toBe(true);
    // The server chunk has no map, so the exact next.config line is printed.
    expect(stderr).toContain("experimental: { serverSourceMaps: true }");
    // --dry-run never touches the build output.
    expect(fs.readFileSync(path.join(dir, ".next/static/chunks/main.js"), "utf-8")).toBe(before);
  });

  it("fails loud when the build uses subresource integrity", async () => {
    const dir = makeTempDir();
    writeFile(dir, ".next/static/chunks/main.js", "console.log(1)\n");
    writeFile(dir, ".next/app-build-manifest.json", JSON.stringify({ pages: { "/": [{ src: "a.js", integrity: "sha384-abc" }] } }));
    await expect(run(["sourcemaps", "upload", path.join(dir, ".next"), "--dry-run"])).rejects.toThrow(/subresource integrity/i);
  });
});
