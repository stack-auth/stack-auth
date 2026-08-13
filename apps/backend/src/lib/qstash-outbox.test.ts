import { describe, expect, it } from "vitest";
import { buildTelemetryMaterializationMessage, decodeBackgroundJobEnvelope, decodeQstashMessage } from "./qstash-outbox";

describe("QStash outbox job contracts", () => {
  it("uses a compact, deterministic telemetry materialization pointer", () => {
    const first = buildTelemetryMaterializationMessage({
      tenancyId: "00000000-0000-4000-8000-000000000001",
      batchId: "envelope:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const second = buildTelemetryMaterializationMessage({
      tenancyId: "00000000-0000-4000-8000-000000000001",
      batchId: "envelope:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(first).toEqual(second);
    expect(first.jobType).toBe("telemetry-materialization");
    expect(first.message.url).toBe("/api/latest/internal/telemetry/materialize");
    expect(first.message.body).toEqual({
      tenancyId: "00000000-0000-4000-8000-000000000001",
      batchId: "envelope:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(first.message.flowControl).toEqual({
      key: "telemetry-materialization:00000000-0000-4000-8000-000000000001",
      parallelism: 4,
    });
  });

  it("decodes legacy outbox rows while validating the optional job envelope", () => {
    expect(decodeQstashMessage({
      url: "/api/latest/internal/external-db-sync/sync-engine",
      body: { tenancyId: "tenancy-id" },
    })).toEqual({
      url: "/api/latest/internal/external-db-sync/sync-engine",
      body: { tenancyId: "tenancy-id" },
    });

    expect(decodeBackgroundJobEnvelope({
      schemaVersion: 1,
      jobId: "job-id",
      jobType: "telemetry-materialization",
      tenancyId: "tenancy-id",
      deduplicationKey: "job-key",
      payload: { batchId: "batch-id" },
    })).toEqual({
      schemaVersion: 1,
      jobId: "job-id",
      jobType: "telemetry-materialization",
      tenancyId: "tenancy-id",
      deduplicationKey: "job-key",
      payload: { batchId: "batch-id" },
    });

    expect(() => decodeBackgroundJobEnvelope({
      schemaVersion: 1,
      jobId: "job-id",
      jobType: "unknown",
      tenancyId: null,
      deduplicationKey: "job-key",
      payload: {},
    })).toThrow("qstashOptions.job is invalid");
  });
});
