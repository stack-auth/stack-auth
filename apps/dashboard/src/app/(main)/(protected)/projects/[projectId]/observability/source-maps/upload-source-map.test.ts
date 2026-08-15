import { describe, expect, it } from "vitest";
import {
  appendDebugIdSnippet,
  deriveDebugId,
  normalizeArtifactPath,
  prepareSourceMapUpload,
} from "./upload-source-map";

const bundleSource = "console.log(1);";
const sourceMapSource = "{\"version\":3,\"sources\":[\"src.ts\"],\"names\":[],\"mappings\":\"AAAA\"}";

describe("browser source-map preparation", () => {
  it("derives a stable debug ID from the original bundle and map bytes", async () => {
    const encoder = new TextEncoder();

    await expect(deriveDebugId(encoder.encode(bundleSource), encoder.encode(sourceMapSource)))
      .resolves.toBe("fdecadcc-fcec-429d-868f-cb6db59cb599");
  });

  it("keeps the manifest's canonical key order and uploads injected bytes", async () => {
    const prepared = await prepareSourceMapUpload({
      projectId: "project-source-map-test",
      release: "2026.08.12",
      environment: "production",
      codeFile: "static/app.min.js",
      sourceMapFile: "static/app.min.js.map",
      bundleSource,
      sourceMapSource,
    });

    expect(Object.keys(prepared.manifest)).toEqual([
      "schemaVersion",
      "projectId",
      "release",
      "dist",
      "environment",
      "artifacts",
    ]);
    expect(Object.keys(prepared.manifest.artifacts[0])).toEqual([
      "debugId",
      "codeFile",
      "sourceMapFile",
      "sourceMapInline",
      "bundleSha256",
      "bundleBytes",
      "sourceMapSha256",
      "sourceMapBytes",
      "sourceMapGzippedBytes",
    ]);
    expect(prepared.bundleSource).toContain("// hexclave:debug-id-injection:start");
    expect(prepared.bundleSource).toContain(`//# debugId=${prepared.debugId}`);
    expect(prepared.sourceMapJson).toContain(`"debug_id":"${prepared.debugId}"`);
    expect(prepared.sourceMapJson).toContain(`"debugId":"${prepared.debugId}"`);
    expect(prepared.manifestJson).toBe(JSON.stringify(prepared.manifest));
    expect(prepared.bundleUploadBody.size).toBe(new TextEncoder().encode(prepared.bundleSource).byteLength);
    expect(prepared.sourceMapUploadBody.size).toBe(prepared.manifest.artifacts[0].sourceMapGzippedBytes);
  });

  it("inserts the runtime snippet before a trailing sourceMappingURL", () => {
    const debugId = "fdecadcc-fcec-429d-868f-cb6db59cb599";
    const injected = appendDebugIdSnippet(
      `${bundleSource}\n//# sourceMappingURL=app.min.js.map`,
      debugId,
    );

    expect(injected).toContain(`hexclave-dbid-${debugId}`);
    expect(injected.endsWith("//# sourceMappingURL=app.min.js.map")).toBe(true);
  });

  it("rejects unsafe artifact paths before registration", () => {
    expect(() => normalizeArtifactPath("static/app.js")).not.toThrow();
    expect(() => normalizeArtifactPath("../app.js")).toThrow("..");
    expect(() => normalizeArtifactPath("/static/app.js")).toThrow("relative POSIX path");
    expect(() => normalizeArtifactPath("https://example.test/app.js")).toThrow("relative POSIX path");
  });
});
