import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createGrowthAdminReportPresentation,
  getGrowthAdminReportPresentations,
  publishGrowthAdminReportPresentation,
  unpublishGrowthAdminReportPresentation,
} from "./growth-reports-admin-api";
import { requestGrowthAdminJson } from "../growth-api";

vi.mock("../growth-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../growth-api")>();
  return { ...actual, requestGrowthAdminJson: vi.fn() };
});

const request = vi.mocked(requestGrowthAdminJson);

const snapshot = {
  id: "presentation-1",
  report_id: "report-1",
  format: "sandboxed-tsx-v1",
  tsx_source: "const Dashboard = () => <div />;",
  action_item_ids: ["action-2", "action-1"],
  version: 2,
  created_at_millis: 1_700_000_000_000,
  created_by_user_id: "staff-1",
  published_at_millis: null,
  published_by_user_id: null,
};

describe("Growth report presentation admin API", () => {
  beforeEach(() => {
    request.mockReset();
  });

  test("lists and maps presentation versions", async () => {
    request.mockResolvedValueOnce({ presentations: [snapshot] });
    await expect(getGrowthAdminReportPresentations({}, "project-1", "report-1")).resolves.toEqual([{
      id: "presentation-1",
      reportId: "report-1",
      format: "sandboxed-tsx-v1",
      tsxSource: "const Dashboard = () => <div />;",
      actionItemIds: ["action-2", "action-1"],
      version: 2,
      createdAtMillis: 1_700_000_000_000,
      createdByUserId: "staff-1",
      publishedAtMillis: null,
      publishedByUserId: null,
    }]);
    expect(request).toHaveBeenCalledWith({}, "/reports/report-1/presentations?project_id=project-1");
  });

  test("creates a version with the authored source and ordered action IDs", async () => {
    request.mockResolvedValueOnce(snapshot);
    await createGrowthAdminReportPresentation({}, "project-1", "report-1", {
      format: "sandboxed-tsx-v1",
      tsxSource: snapshot.tsx_source,
      actionItemIds: snapshot.action_item_ids,
    });
    expect(request).toHaveBeenCalledWith({}, "/reports/report-1/presentations", {
      method: "POST",
      body: JSON.stringify({
        target_project_id: "project-1",
        format: "sandboxed-tsx-v1",
        tsx_source: snapshot.tsx_source,
        action_item_ids: snapshot.action_item_ids,
      }),
    });
  });

  test.each([
    ["publish", publishGrowthAdminReportPresentation],
    ["unpublish", unpublishGrowthAdminReportPresentation],
  ])("%s returns the authoritative presentation snapshot", async (action, mutation) => {
    request.mockResolvedValueOnce(snapshot);
    await mutation({}, "project-1", "report-1", "presentation-1");
    expect(request).toHaveBeenCalledWith({}, "/reports/report-1/presentations/presentation-1", {
      method: "PATCH",
      body: JSON.stringify({ target_project_id: "project-1", action }),
    });
  });
});
