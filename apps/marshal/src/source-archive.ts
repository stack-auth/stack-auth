import { gunzipSync } from "node:zlib";
import { badRequest } from "./errors.js";

const TAR_BLOCK_SIZE = 512;
const MAX_SOURCE_ENTRIES = 50_000;
export const MAX_UNCOMPRESSED_SOURCE_BYTES = 256 * 1024 * 1024;

function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(offset, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const value = readString(block, offset, length).trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/.test(value)) throw badRequest("invalid source archive: malformed tar header");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) throw badRequest("invalid source archive: tar field is too large");
  return parsed;
}

function validateEntryPath(path: string): void {
  // Only accept the normalized relative paths emitted by the Hexclave CLI. Rejecting every
  // extension/link type makes extraction safe even though the Fly builder runs as root.
  // eslint-disable-next-line no-control-regex
  if (path === "" || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f]/.test(path)
    || path.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    throw badRequest(`invalid source archive: unsafe entry path ${JSON.stringify(path)}`);
  }
}

export function validateUncompressedSourceTar(bytes: Uint8Array): void {
  let offset = 0;
  let entries = 0;
  let totalBytes = 0;
  while (offset + TAR_BLOCK_SIZE <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every(byte => byte === 0)) {
      if (!bytes.subarray(offset).every(byte => byte === 0)) throw badRequest("invalid source archive: data follows the end marker");
      return;
    }
    if (readString(header, 257, 6) !== "ustar") throw badRequest("invalid source archive: not a ustar archive");

    let expectedChecksum = 0;
    for (let index = 0; index < TAR_BLOCK_SIZE; index++) {
      expectedChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (readOctal(header, 148, 8) !== expectedChecksum) throw badRequest("invalid source archive: tar header checksum mismatch");

    const type = header[156];
    if (type !== 0 && type !== 0x30 && type !== 0x35) {
      throw badRequest("invalid source archive: only regular files and directories are supported");
    }
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    validateEntryPath(type === 0x35 && path.endsWith("/") ? path.slice(0, -1) : path);

    const size = readOctal(header, 124, 12);
    if (type === 0x35 && size !== 0) throw badRequest("invalid source archive: directory entry has data");
    entries++;
    totalBytes += size;
    if (entries > MAX_SOURCE_ENTRIES) throw badRequest(`source archive contains too many entries (maximum ${MAX_SOURCE_ENTRIES})`);
    if (totalBytes > MAX_UNCOMPRESSED_SOURCE_BYTES) throw badRequest(`source archive contents exceed ${MAX_UNCOMPRESSED_SOURCE_BYTES} bytes`);

    offset += TAR_BLOCK_SIZE;
    if (offset + size > bytes.length) throw badRequest("invalid source archive: truncated file data");
    offset += size + ((TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE);
  }
  throw badRequest("invalid source archive: missing end marker");
}

export function validateSourceArchive(bytes: Uint8Array): void {
  let uncompressed: Buffer;
  try {
    uncompressed = gunzipSync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_SOURCE_BYTES });
  } catch (error) {
    if (error instanceof Error) throw badRequest("invalid source archive: gzip decompression failed or exceeded the size limit");
    throw error;
  }
  validateUncompressedSourceTar(uncompressed);
}
