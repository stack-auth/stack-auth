import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertMocksExplicitlyAllowed } from "./config.js";
import { builderAppName, builderNetworkName, appNameForService } from "./naming.js";
import { validateServiceSpec } from "./services.js";
import { validateSourceArchive } from "./source-archive.js";

function writeString(buffer: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) throw new Error("test tar field is too long");
  buffer.set(bytes, offset);
}

function writeOctal(buffer: Uint8Array, offset: number, length: number, value: number): void {
  writeString(buffer, offset, length - 1, value.toString(8).padStart(length - 1, "0"));
}

function sourceArchive(path: string, type: number = 0x30): Uint8Array {
  const tar = new Uint8Array(3 * 512);
  writeString(tar, 0, 100, path);
  writeOctal(tar, 100, 8, 0o644);
  writeOctal(tar, 108, 8, 0);
  writeOctal(tar, 116, 8, 0);
  writeOctal(tar, 124, 12, 0);
  writeOctal(tar, 136, 12, 0);
  tar[156] = type;
  writeString(tar, 257, 6, "ustar");
  tar[263] = 0x30;
  tar[264] = 0x30;
  tar.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of tar.subarray(0, 512)) checksum += byte;
  tar.fill(0, 148, 156);
  writeOctal(tar, 148, 7, checksum);
  tar[155] = 0x20;
  return gzipSync(tar);
}

describe("source archive validation", () => {
  it("accepts the regular-file ustar subset emitted by the CLI", async () => {
    await expect(validateSourceArchive(sourceArchive("src/index.ts"))).resolves.toBeUndefined();
  });

  it("rejects traversal and link entries before the builder receives credentials", async () => {
    await expect(validateSourceArchive(sourceArchive("../escape"))).rejects.toThrow("unsafe entry path");
    await expect(validateSourceArchive(sourceArchive("src/link", 0x32))).rejects.toThrow("only regular files and directories");
    await expect(validateSourceArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow("gzip decompression failed");
  });

  it("releases its inflation slot on both success and failure", async () => {
    // The semaphore is process-wide, so a slot leaked on the rejection path would
    // deadlock every later deploy rather than merely slowing one down. More
    // iterations than MAX_CONCURRENT_INFLATIONS, so a leak cannot hide.
    for (let attempt = 0; attempt < 6; attempt++) {
      await expect(validateSourceArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow("gzip decompression failed");
    }
    await expect(validateSourceArchive(sourceArchive("src/index.ts"))).resolves.toBeUndefined();
    // Concurrent callers all finish rather than queueing behind a lost slot.
    await expect(Promise.all([
      validateSourceArchive(sourceArchive("a.ts")),
      validateSourceArchive(sourceArchive("b.ts")),
      validateSourceArchive(sourceArchive("c.ts")),
    ])).resolves.toHaveLength(3);
  });
});
describe("runtime identity", () => {
  it("does not collide for inputs that shared the former 24-bit suffix", () => {
    const first = appNameForService("production", "12345678-tenant", "abcdefgh-2792");
    const second = appNameForService("production", "12345678-tenant", "abcdefgh-4185");
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(30);
    expect(second.length).toBeLessThanOrEqual(30);
  });

  it("hashes the full environment into builder identities", () => {
    expect(builderAppName("abcdefgh-one")).not.toBe(builderAppName("abcdefgh-two"));
    expect(builderNetworkName("abcdefgh-one")).not.toBe(builderNetworkName("abcdefgh-two"));
  });
});

describe("mock safety", () => {
  it("fails closed unless mocks are explicitly enabled", () => {
    expect(() => assertMocksExplicitlyAllowed("mock Fly", {})).toThrow("requires MARSHAL_ALLOW_MOCKS=1");
    expect(() => assertMocksExplicitlyAllowed("mock Fly", { NODE_ENV: "development" })).toThrow("requires MARSHAL_ALLOW_MOCKS=1");
    expect(() => assertMocksExplicitlyAllowed("mock Fly", { MARSHAL_ALLOW_MOCKS: "1" })).not.toThrow();
  });
});

describe("special environment keys", () => {
  it("preserves __proto__ as an own property during spec validation", () => {
    const env = Object.fromEntries([["__proto__", { value: "safe" }]]);
    const spec = validateServiceSpec({
      config: { type: "serverless", min_instances: 0, max_instances: 1, ports: [{ port: 3000 }] },
      source: { image: "example/image" },
      env,
    });
    expect(Object.hasOwn(spec.env, "__proto__")).toBe(true);
    expect(spec.env.__proto__).toEqual({ value: "safe" });
  });
});
