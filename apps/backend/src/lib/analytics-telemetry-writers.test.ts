import { describe, expect, it } from "vitest";
import {
  getBatchDestinationDeduplicationToken,
  getEventStorageTable,
  normalizeBatchEvents,
} from "./analytics-telemetry-writers";

describe("analytics telemetry storage dispatch", () => {
  it("keeps product events out of observability logs", () => {
    for (const eventType of ["checkout.completed", "$click", "$form-submit"]) {
      expect(getEventStorageTable(eventType)).toBe("analytics_internal.events");
    }
  });

  it("keeps log-shaped occurrences out of product events", () => {
    expect(getEventStorageTable("$log")).toBe("analytics_internal.logs");
    expect(getEventStorageTable("$error")).toBe("analytics_internal.logs");
  });

  it("uses stable destination-specific idempotency tokens", () => {
    expect(getBatchDestinationDeduplicationToken("batch-1", "analytics_internal.events"))
      .toBe("batch-1:analytics_internal.events");
    expect(getBatchDestinationDeduplicationToken("batch-1", "analytics_internal.logs"))
      .toBe("batch-1:analytics_internal.logs");
    expect(getBatchDestinationDeduplicationToken("batch-1", "analytics_internal.spans"))
      .toBe("batch-1:analytics_internal.spans");
  });

  it("normalizes complete root-first ancestry before storage dispatch", () => {
    const normalized = normalizeBatchEvents([{
      event_type: "$log",
      event_at_ms: 1_700_000_000_000,
      data: {},
      message: "checkout failed",
      level: "error",
      page_view_span_id: "11111111-1111-4111-8111-111111111111",
      parent_span_ids: [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
      http_client_span_id: "44444444-4444-4444-8444-444444444444",
    }], {
      projectId: "project",
      branchId: "branch",
      userId: "user",
      refreshTokenId: "55555555-5555-4555-8555-555555555555",
      sessionReplayId: "66666666-6666-4666-8666-666666666666",
      sessionReplaySegmentId: "77777777-7777-4777-8777-777777777777",
      runtime: "browser",
      resource: {
        service: { namespace: "commerce", name: "storefront", version: "abc123", instanceId: "iad-1" },
        deploymentEnvironmentName: "preview",
        attributes: { region: "iad1" },
      },
    });

    expect(normalized.productEvents).toHaveLength(0);
    expect(normalized.logOccurrences[0].parent_span_ids).toEqual([
      "rti-55555555-5555-4555-8555-555555555555",
      "sri-66666666-6666-4666-8666-666666666666",
      "srsi-66666666-6666-4666-8666-666666666666:77777777-7777-4777-8777-777777777777",
      "pv-11111111-1111-4111-8111-111111111111",
      "cs-22222222-2222-4222-8222-222222222222",
      "cs-33333333-3333-4333-8333-333333333333",
      "hc-44444444-4444-4444-8444-444444444444",
    ]);
    expect(normalized.logOccurrences[0]).toMatchObject({
      service_namespace: "commerce",
      service_name: "storefront",
      service_version: "abc123",
      service_instance_id: "iad-1",
      deployment_environment_name: "preview",
      resource_attributes: JSON.stringify({ region: "iad1" }),
    });
  });
});
