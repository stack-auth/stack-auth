import { describe, expect, it } from "vitest";
import { getPreviewTargetPath } from "./preview-lease-path";

describe("getPreviewTargetPath", () => {
  it("routes project list paths to the leased project", () => {
    expect(getPreviewTargetPath("/projects", "project-1")).toBe("/projects/project-1");
    expect(getPreviewTargetPath("/projects/", "project-1")).toBe("/projects/project-1");
  });

  it("routes project selector deep links to the leased project", () => {
    expect(getPreviewTargetPath("/projects/-selector-/analytics/tables", "project-1")).toBe("/projects/project-1/analytics/tables");
  });

  it("replaces existing project ids while preserving the page path", () => {
    expect(getPreviewTargetPath("/projects/old-project/auth/users", "project-1")).toBe("/projects/project-1/auth/users");
  });

  it("leaves non-project paths unchanged", () => {
    expect(getPreviewTargetPath("/settings/account", "project-1")).toBe("/settings/account");
  });
});
