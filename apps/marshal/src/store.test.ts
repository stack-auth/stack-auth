import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomainClaim, StoredSpec } from "./types.js";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...original,
    S3Client: class {
      send = send;
    },
  };
});

vi.mock("./config.js", () => ({
  getConfig: () => ({
    dataEncryptionRootKey: Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex"),
    s3: {
      region: "test",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      bucket: "test-bucket",
    },
  }),
  MAX_UPLOAD_BYTES: 1,
  UPLOAD_EXPIRY_SECONDS: 1,
}));

import { readSpec, releaseDomainClaim, writeSpec } from "./store.js";

describe("domain claim release", () => {
  const claim = {
    hostname: "app.example.com",
    ns: "test-namespace",
    service_key: "test-service",
    claimed_at_millis: 1,
  } satisfies DomainClaim;

  afterEach(() => {
    send.mockReset();
  });

  it("deletes the claim and index when the ETag still matches", async () => {
    send.mockResolvedValue({});

    await expect(releaseDomainClaim({ value: claim, etag: "claim-etag" })).resolves.toBe(true);

    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      input: {
        Bucket: "test-bucket",
        Key: "domains/app.example.com.json",
        IfMatch: "claim-etag",
      },
    }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      input: {
        Bucket: "test-bucket",
        Key: "domain-index/test-namespace/test-service/app.example.com",
      },
    }));
  });

  it("preserves a concurrently replaced claim when the ETag no longer matches", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("precondition failed"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    }));

    await expect(releaseDomainClaim({ value: claim, etag: "stale-etag" })).resolves.toBe(false);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });
});

describe("stored service spec encryption", () => {
  const spec = {
    ns: "test-namespace",
    key: "web",
    spec: {
      config: { min_instances: 0, max_instances: 1, port: 3000 },
      source: { image: "registry.example.com/web@sha256:abc" },
      env: {
        API_TOKEN: { value: "tenant-secret-value" },
        DATABASE_URL: { ref: "database.internal_url" },
      },
    },
    revision: "abc123def456",
    created_at_millis: 1,
    updated_at_millis: 2,
    last_apply_error: null,
  } satisfies StoredSpec;

  afterEach(() => {
    send.mockReset();
  });

  it("never writes plaintext environment values and decrypts the stored payload", async () => {
    send.mockResolvedValueOnce({ ETag: "encrypted-etag" });
    await expect(writeSpec(spec, { ifNoneMatch: true })).resolves.toBe("encrypted-etag");

    const command = send.mock.calls[0][0];
    const body = command.input.Body;
    expect(typeof body).toBe("string");
    expect(body).not.toContain("tenant-secret-value");
    expect(body).not.toContain("database.internal_url");
    expect(body).toContain("encrypted_env");

    send.mockResolvedValueOnce({
      Body: { transformToString: async () => body },
      ETag: "encrypted-etag",
    });
    await expect(readSpec(spec.ns, spec.key)).resolves.toEqual(spec);
  });

  it("rejects ciphertext moved to another object or paired with modified plaintext fields", async () => {
    send.mockResolvedValueOnce({ ETag: "encrypted-etag" });
    await writeSpec(spec, { ifNoneMatch: true });
    const body = send.mock.calls[0][0].input.Body;
    if (typeof body !== "string") throw new Error("test S3 request body was not a string");

    send.mockResolvedValueOnce({ Body: { transformToString: async () => body }, ETag: "moved-etag" });
    await expect(readSpec(spec.ns, "worker")).rejects.toThrow(/identity does not match requested object/);

    const tamperedBody = body.replace('"revision":"abc123def456"', '"revision":"attacker-value"');
    expect(tamperedBody).not.toBe(body);
    send.mockResolvedValueOnce({ Body: { transformToString: async () => tamperedBody }, ETag: "tampered-etag" });
    await expect(readSpec(spec.ns, spec.key)).rejects.toThrow();
  });

  it("atomically upgrades a legacy plaintext spec on first read", async () => {
    send.mockResolvedValueOnce({
      Body: { transformToString: async () => JSON.stringify(spec) },
      ETag: "legacy-etag",
    });
    send.mockResolvedValueOnce({ ETag: "upgraded-etag" });

    await expect(readSpec(spec.ns, spec.key)).resolves.toEqual(spec);

    const upgradedBody = send.mock.calls[1][0].input.Body;
    expect(upgradedBody).not.toContain("tenant-secret-value");
    expect(send.mock.calls[1][0].input.IfMatch).toBe("legacy-etag");
  });
});
