import { gzipSync } from "node:zlib";
import { createTar } from "@hexclave/shared/dist/utils/tar";
import { describe, expect, it } from "vitest";
import { ArtifactServiceError } from "./artifact-errors";
import {
  validateArtifactArchiveEntries,
  validateGzipTarArtifactArchive,
  type ArtifactArchiveEntry,
} from "./artifact-archive-safety";

/**
 * Re-derives the ustar header checksum for the first header block, mirroring
 * createTar: sum of all header bytes with the checksum field read as spaces,
 * written as a 6-digit octal + NUL + space.
 */
function recomputeTarHeaderChecksum(tar: Uint8Array): void {
  tar.fill(0x20, 148, 156);
  let checksum = 0;
  for (let index = 0; index < 512; index++) checksum += tar[index];
  tar.fill(0, 148, 156);
  const octal = checksum.toString(8).padStart(6, "0");
  for (let index = 0; index < octal.length; index++) tar[148 + index] = octal.charCodeAt(index);
  tar[155] = 0x20;
}

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

    // A corrupted checksum must be rejected on its own...
    const checksumCorrupted = createTar([{ path: "static/chunk.js", data: new TextEncoder().encode("bundle") }]);
    checksumCorrupted[0] ^= 0xff;
    expect(() => validateGzipTarArtifactArchive(gzipSync(checksumCorrupted))).toThrowError(/checksum mismatch/u);

    // ...and an unsafe typeflag must be rejected even with a *valid* checksum.
    // Recomputing the checksum after patching byte 156 matters: without it the
    // checksum guard fires first and the typeflag boundary goes untested.
    const tar = createTar([{ path: "static/chunk.js", data: new TextEncoder().encode("bundle") }]);
    tar[156] = 0x32; // '2' = symlink
    recomputeTarHeaderChecksum(tar);
    expectInvalidArchive(() => validateGzipTarArtifactArchive(gzipSync(tar)));
    expect(() => validateGzipTarArtifactArchive(gzipSync(tar))).toThrowError(/only regular files and directories/u);
  });
});
