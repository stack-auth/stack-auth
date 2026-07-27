import type { WorkflowVersionJson } from "@hexclave/shared/dist/interface/workflows";
import { describe, expect, it } from "vitest";
import { adminWorkflowVersionFromCrud } from "./workflows";

describe("adminWorkflowVersionFromCrud", () => {
  it("preserves the deployment source hash", () => {
    const version: WorkflowVersionJson = {
      workflow_id: "daily-report",
      version: 3,
      source: "export default 1",
      source_hash: "0123456789abcdef",
      runtime_env_version: "v1",
      is_latest: true,
      in_flight_runs: 2,
      created_at_millis: 1234,
    };

    expect(adminWorkflowVersionFromCrud(version)).toMatchObject({
      workflowId: "daily-report",
      version: 3,
      sourceHash: "0123456789abcdef",
    });
  });
});
