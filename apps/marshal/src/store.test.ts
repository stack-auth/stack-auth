import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomainClaim } from "./types.js";

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

import { releaseDomainClaim } from "./store.js";

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
