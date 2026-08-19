import { describe, expect, it, vi } from "vitest";
import { validateImageRef } from "./image-ref.js";
import { isPublicAddress, resolveImage } from "./registry.js";

// resolveImage reads the registry mode from config; the rest of the module's
// config (Fly, S3) is irrelevant here, so only that one field is stubbed.
vi.mock("./config.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./config.js")>(),
  getConfig: () => ({ registryKind: "real" }),
}));

describe("validateImageRef", () => {
  it("fully qualifies every accepted spelling", () => {
    // Normalized before it is used, because the resolver has to know which host
    // to ask and the spec has to name what is actually pulled.
    expect(validateImageRef("postgres:16", "image")).toMatchObject({
      registry: "docker.io", repository: "library/postgres", tag: "16", digest: null, canonical: "docker.io/library/postgres:16",
    });
    expect(validateImageRef("myorg/app:1.2.3", "image")).toMatchObject({ registry: "docker.io", repository: "myorg/app" });
    expect(validateImageRef("ghcr.io/org/app:1.2.3", "image")).toMatchObject({ registry: "ghcr.io", repository: "org/app" });
    // A ":" before the last "/" is a registry PORT, not a tag.
    expect(validateImageRef("registry.example.com:5000/team/app:v1", "image")).toMatchObject({
      registry: "registry.example.com:5000", repository: "team/app", tag: "v1",
    });
    const digest = `sha256:${"a".repeat(64)}`;
    expect(validateImageRef(`postgres@${digest}`, "image")).toMatchObject({ tag: null, digest });
  });

  it("refuses references that would not name fixed bytes", () => {
    // Marshal is the last line before the runtime and repeats the rules the CLI
    // and the backend already applied, rather than trusting them.
    expect(() => validateImageRef("postgres", "image")).toThrow(/explicit tag or digest/);
    expect(() => validateImageRef("Postgres:16", "image")).toThrow(/invalid repository path segment/);
    expect(() => validateImageRef("postgres@sha256:abc", "image")).toThrow(/invalid digest/);
    expect(() => validateImageRef("postgres:16\tx", "image")).toThrow(/whitespace or control characters/);
    expect(() => validateImageRef("", "image")).toThrow(/non-empty/);
    expect(() => validateImageRef(undefined, "image")).toThrow(/non-empty/);
  });
});

describe("isPublicAddress", () => {
  it("refuses every private destination a registry host could resolve to", () => {
    // This is the SSRF boundary: the registry host comes from a user's deploy
    // file, and Marshal can reach infrastructure the user cannot.
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.1.2.3")).toBe(false);
    expect(isPublicAddress("172.16.0.1")).toBe(false);
    expect(isPublicAddress("172.31.255.255")).toBe(false);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
    // The cloud metadata address, which is the whole reason this check exists.
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("0.0.0.0")).toBe(false);
    expect(isPublicAddress("224.0.0.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fe80::1")).toBe(false);
    expect(isPublicAddress("fd00::1")).toBe(false);
    // An IPv4 destination wearing an IPv6 name is still that destination.
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false);
    // Anything unparseable fails closed rather than being assumed public.
    expect(isPublicAddress("not-an-address")).toBe(false);
    expect(isPublicAddress("172.16")).toBe(false);
  });

  it("accepts real registry addresses", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("172.15.0.1")).toBe(true); // just outside RFC1918
    expect(isPublicAddress("172.32.0.1")).toBe(true); // just outside RFC1918
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});

describe("resolveImage", () => {
  it("refuses a registry host that resolves to a private address", async () => {
    // The end-to-end shape of the SSRF guard, exercised through the same entry
    // point a deployment uses. "localhost" needs no network to resolve, and it
    // is exactly the destination a user could name to reach Marshal's own host.
    await expect(resolveImage(validateImageRef("localhost:5000/app:v1", "image")))
      .rejects.toThrow(/non-public address/);
    await expect(resolveImage(validateImageRef("127.0.0.1:5000/app:v1", "image")))
      .rejects.toThrow(/non-public address/);
    // The cloud metadata address, spelled as a literal so no DNS is involved.
    await expect(resolveImage(validateImageRef("169.254.169.254/app:v1", "image")))
      .rejects.toThrow(/non-public address/);
  }, 30000);

  it("refuses a registry host that does not resolve at all", async () => {
    await expect(resolveImage(validateImageRef("this-host-does-not-exist.invalid/app:v1", "image")))
      .rejects.toThrow(/could not be resolved/);
  }, 30000);
});
