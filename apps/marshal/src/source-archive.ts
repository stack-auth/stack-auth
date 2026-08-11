import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { badRequest } from "./errors.js";

const TAR_BLOCK_SIZE = 512;
const MAX_SOURCE_ENTRIES = 50_000;
export const MAX_UNCOMPRESSED_SOURCE_BYTES = 256 * 1024 * 1024;

// How many archives may be inflated at once, process-wide.
//
// Marshal is a single shared process serving every tenant, and an inflation holds
// both the compressed upload and its expansion in memory at the same time — up to
// MAX_UPLOAD_BYTES + MAX_UNCOMPRESSED_SOURCE_BYTES each. Unbounded concurrency
// let a handful of simultaneous but entirely VALID deploys add up to gigabytes,
// which is a resource fault rather than a rejected request: the reconciliation
// lease heartbeats and every other tenant's requests are served by this process.
// Two at a time bounds the peak while still overlapping the S3 reads around them.
const MAX_CONCURRENT_INFLATIONS = 2;

const gunzipAsync = promisify(gunzip);

let activeInflations = 0;
const waitingInflations: (() => void)[] = [];

async function acquireInflationSlot(): Promise<void> {
  if (activeInflations < MAX_CONCURRENT_INFLATIONS) {
    activeInflations++;
    return;
  }
  await new Promise<void>((resolve) => waitingInflations.push(resolve));
  activeInflations++;
}

function releaseInflationSlot(): void {
  activeInflations--;
  const next = waitingInflations.shift();
  if (next !== undefined) next();
}

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

/**
 * Inflates and structurally validates an uploaded source archive.
 *
 * ASYNC, and deliberately so: the previous gunzipSync ran the whole inflation —
 * as much as MAX_UNCOMPRESSED_SOURCE_BYTES of it — on the event loop, so one
 * large but perfectly valid archive stalled reconciliation, lease heartbeats and
 * every concurrent request for its duration. zlib's callback form does the work
 * on the libuv threadpool instead. The slot acquired around it bounds how many
 * can be in flight at once; see MAX_CONCURRENT_INFLATIONS.
 */
export async function validateSourceArchive(bytes: Uint8Array): Promise<void> {
  await acquireInflationSlot();
  let uncompressed: Buffer;
  try {
    uncompressed = await gunzipAsync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_SOURCE_BYTES });
  } catch (error) {
    if (error instanceof Error) throw badRequest("invalid source archive: gzip decompression failed or exceeded the size limit");
    throw error;
  } finally {
    releaseInflationSlot();
  }
  validateUncompressedSourceTar(uncompressed);
}
