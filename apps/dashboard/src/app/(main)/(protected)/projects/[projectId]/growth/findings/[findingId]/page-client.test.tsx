// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGrowthOverview } from "@/lib/growth/growth-api";
import { FindingDetailContent } from "./page-client";

vi.mock("@/lib/growth/growth-api", () => ({
  getGrowthOverview: vi.fn(),
}));
vi.mock("@/lib/growth/growth-data", () => ({
  useGrowthStatus: () => ({ demo: false }),
}));
vi.mock("@/components/link", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("../../../use-admin-app", () => ({
  useAdminApp: () => ({}),
  useProjectId: () => "project-1",
}));
vi.mock("../../components/action-card", () => ({
  useGrowthHref: () => (href: string) => href,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FindingDetailContent", () => {
  it("renders the report preparation state without requesting gated evidence", () => {
    render(<FindingDetailContent releaseState="preparing" />);

    expect(screen.getByText("We're putting your report together")).toBeTruthy();
    expect(screen.getByText(/check back in about 24 hours/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Growth overview" }).getAttribute("href")).toBe("/projects/project-1/growth");
    expect(getGrowthOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("does not claim analysis is running before the first run starts", () => {
    render(<FindingDetailContent releaseState="not_ready" />);

    expect(screen.getByText("Your Growth report isn't ready yet")).toBeTruthy();
    expect(screen.getByText(/complete your first Growth analysis/i)).toBeTruthy();
    expect(getGrowthOverview).not.toHaveBeenCalled();
  });
});
