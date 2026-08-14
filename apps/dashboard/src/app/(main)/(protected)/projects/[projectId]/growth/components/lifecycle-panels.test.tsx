// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGrowthDemoStatus, GROWTH_DEMO_NOW_MILLIS } from "@/lib/growth/growth-demo-data";
import type { GrowthStatus } from "@/lib/growth/growth-types";
import { IntegrationsStep } from "./lifecycle-panels";

vi.mock("@/lib/growth/growth-data", () => ({
  useGrowthStatus: () => ({ demo: false, refresh: vi.fn(), data: { status: "loading" } }),
}));
vi.mock("../../use-admin-app", () => ({
  useAdminApp: () => ({}),
  useProjectId: () => "proj_1",
}));
vi.mock("./action-card", () => ({
  useGrowthHref: () => (href: string) => href,
}));
vi.mock("@/components/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./timeline", () => ({
  GrowthTimelineStep: ({ title, children }: { title: ReactNode, children?: ReactNode }) => (
    <div><span>{title}</span>{children}</div>
  ),
}));

afterEach(() => cleanup());

function waitingStatus(): GrowthStatus {
  const base = buildGrowthDemoStatus("analyzing", GROWTH_DEMO_NOW_MILLIS);
  return {
    ...base,
    analysis: {
      ...base.analysis,
      runId: "00000000-0000-0000-0000-000000000001",
      computeMetrics: { state: "done", metricLabels: ["Daily active users"] },
      integrations: { state: "waiting" },
    },
  };
}

/**
 * The regression this file exists for: the integrations panel is the ONLY way to resume a run that
 * the backend has parked on the human's answer, and the answer must never be gated on an
 * ad-platform connection the backend cannot observe. A previous version showed "Continue" only when
 * the status reported a ready connection — a flag this build hardcodes false — so connecting left
 * the user with no forward path at all.
 */
describe("IntegrationsStep", () => {
  it("always offers both answers while the run waits, regardless of any connection", () => {
    render(<IntegrationsStep status={waitingStatus()} state="current" />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  it("offers connecting as a detour rather than a precondition for answering", () => {
    render(<IntegrationsStep status={waitingStatus()} state="current" />);
    expect(screen.getByRole("button", { name: "Connect Meta ads" })).toBeTruthy();
    // No claim of live/real campaign data: this build's ad-platform connection is browser-local and
    // never reaches the analysis, and the panel must not imply otherwise.
    expect(document.body.textContent).not.toMatch(/live campaign data|real campaign data/i);
  });

  it("renders nothing for runs predating the integrations phase", () => {
    const { container } = render(<IntegrationsStep status={waitingStatus()} state="hidden" />);
    expect(container.innerHTML).toBe("");
  });
});
