import { gzipSync } from "node:zlib";
import { createTar } from "@hexclave/shared/dist/utils/tar";
import { describe, expect, it } from "vitest";
import { ArtifactServiceError } from "./artifact-errors";
import {
  validateArtifactArchiveEntries,
  validateGzipTarArtifactArchive,
  type ArtifactArchiveEntry,
} from "./artifact-archive-safety";

function expectInvalidArchive(run: () => unknown): void {
  expect(run).toThrowError(ArtifactServiceError);
  try {
    run();
  } catch (error) {
    if (error instanceof ArtifactServiceError) expect(error.code).toBe("invalid_archive");
  }
}

describe("artifact archive safety", () => {
  it("accepts a bounded gzip ustar archive and normalizes directory markers", () => {
    const tar = createTar([
      { path: "static/", data: new Uint8Array(0) },
      { path: "static/chunk.js", data: new TextEncoder().encode("bundle") },
    ]);

    expect(validateGzipTarArtifactArchive(gzipSync(tar))).toEqual([
      { path: "static", kind: "directory", byteLength: 0 },
      { path: "static/chunk.js", kind: "file", byteLength: 6 },
    ]);
  });

  it("rejects traversal, absolute, duplicate, and over-limit entries before extraction", () => {
    const unsafeEntries: ArtifactArchiveEntry[] = [
      { path: "../escape.js", kind: "file", byteLength: 1 },
    ];
    expectInvalidArchive(() => validateArtifactArchiveEntries(unsafeEntries));
    expectInvalidArchive(() => validateArtifactArchiveEntries([
      { path: "static/chunk.js", kind: "file", byteLength: 1 },
      { path: "static/chunk.js", kind: "file", byteLength: 1 },
    ]));
    expectInvalidArchive(() => validateArtifactArchiveEntries([
      { path: "/etc/passwd", kind: "file", byteLength: 1 },
    ]));
    expectInvalidArchive(() => validateArtifactArchiveEntries([
      { path: "static/chunk.js", kind: "file", byteLength: 10 },
    ], { maxBytes: 9 }));
  });

  it("rejects corrupt gzip data and archives with unsafe tar entry types", () => {
    expectInvalidArchive(() => validateGzipTarArtifactArchive(new TextEncoder().encode("not gzip")));

    const tar = createTar([{ path: "static/chunk.js", data: new TextEncoder().encode("bundle") }]);
    tar[156] = 0x32;
    expectInvalidArchive(() => validateGzipTarArtifactArchive(gzipSync(tar)));
  });
});
