// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTvFixtureSnapshot } from "@/lib/tv-mode/fixtures";
import { getTvInsightPresentation, renderTvScreen } from "./screen-registry";
import { TvPresentation } from "./tv-presentation";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TvPresentation rotation", () => {
  it("does not restart rotation or reset the current screen when polling replaces the snapshot", async () => {
    vi.useFakeTimers();
    const fixtureSnapshot = getTvFixtureSnapshot("project-a", "company-pulse");
    if (fixtureSnapshot == null) throw new Error("Missing company-pulse fixture");
    // Keep this polling-regression test on a uniform clock. Per-screen timing
    // is covered separately and should not change its 15s + 5s assertions.
    const snapshot = {
      ...fixtureSnapshot,
      profile: {
        ...fixtureSnapshot.profile,
        screenDurations: fixtureSnapshot.profile.playlist.map((screenId) => ({
          screenId,
          durationSeconds: 20,
        })),
      },
    };
    const { rerender } = render(
      <TvPresentation snapshot={snapshot} onExit={() => undefined} />,
    );

    expect(screen.getByRole("heading", { name: "Live Pulse" })).toBeDefined();
    await act(() => vi.advanceTimersByTime(15_000));

    const refreshedSnapshot = {
      ...snapshot,
      generatedAt: "2026-07-23T14:32:15.000Z",
      staleAfter: "2026-07-23T14:33:00.000Z",
    };
    rerender(<TvPresentation snapshot={refreshedSnapshot} onExit={() => undefined} />);

    await act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByLabelText("Screen 2 of 4")).toBeDefined();

    await act(() => vi.advanceTimersByTime(15_000));
    rerender(
      <TvPresentation
        snapshot={{
          ...refreshedSnapshot,
          generatedAt: "2026-07-23T14:32:30.000Z",
          staleAfter: "2026-07-23T14:33:15.000Z",
        }}
        onExit={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Screen 2 of 4")).toBeDefined();
    await act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByLabelText("Screen 3 of 4")).toBeDefined();
  });
});

describe("TV chart headers", () => {
  it.each([
    ["live-pulse", "Today’s activity", "Current UTC day"],
    ["audience-momentum", "Audience lifecycle", "Daily activity · trailing 7 days"],
    ["revenue-payments", "Paid revenue momentum", "Cumulative daily trend · trailing 30 days"],
    ["email-health", "Email delivery volume", "Daily send status · trailing 7 days"],
  ] as const)("labels the %s chart and its reporting window", (screenId, title, subtitle) => {
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse");
    if (snapshot == null) throw new Error("Missing company-pulse fixture");

    const selectedScreen = snapshot.screens.find((candidate) => candidate.id === screenId);
    if (selectedScreen == null) throw new Error(`Missing ${screenId} fixture screen`);
    render(renderTvScreen(selectedScreen));

    expect(screen.getByText(title)).toBeDefined();
    expect(screen.getByText(subtitle)).toBeDefined();
  });
});

describe("TV interruption presentation", () => {
  it("renders Event Highlights through the shared screen header accessory", () => {
    const snapshot = getTvFixtureSnapshot(
      "project-a",
      "company-pulse",
      "celebration-animation-expired",
    );
    if (snapshot == null) throw new Error("Missing celebration Highlight fixture");

    render(<TvPresentation snapshot={snapshot} onExit={() => undefined} />);

    expect(screen.getByText("Event Highlight")).toBeDefined();
    expect(screen.getByRole("heading", { name: "500 users" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Live Pulse" })).toBeDefined();
  });

  it("renders the persistent Critical Incident instead of the playlist", () => {
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse", "critical-takeover");
    if (snapshot == null) throw new Error("Missing Critical Incident fixture");

    render(<TvPresentation snapshot={snapshot} onExit={() => undefined} />);

    expect(screen.getByText("Critical incident")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Email delivery degraded" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Live Pulse" })).toBeNull();
  });

  it("renders recovery-specific takeover and Highlight presentations", () => {
    const recoveryScreen = getTvFixtureSnapshot("project-a", "company-pulse", "incident-recovery");
    const recoveryHighlight = getTvFixtureSnapshot("project-a", "company-pulse", "incident-recovery-highlight");
    if (recoveryScreen == null || recoveryHighlight == null) throw new Error("Missing incident recovery fixtures");

    const recoveryScreenRender = render(<TvPresentation snapshot={recoveryScreen} onExit={() => undefined} />);
    expect(screen.getByText("Incident resolved")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Email Delivery Restored" })).toBeDefined();
    recoveryScreenRender.unmount();

    render(<TvPresentation snapshot={recoveryHighlight} onExit={() => undefined} />);
    expect(screen.getByText("Resolved")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Email Delivery Restored" })).toBeDefined();
    expect(screen.getByText("Expected 95% or higher", { exact: false })).toBeDefined();
  });

  it("arms one visible takeover entrance layer only after loading is uncovered", () => {
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-takeover");
    if (snapshot == null) throw new Error("Missing celebration takeover fixture");

    const { container, rerender } = render(
      <TvPresentation snapshot={null} loading onExit={() => undefined} />,
    );
    expect(container.querySelectorAll("[data-entry-burst='active']")).toHaveLength(0);

    rerender(<TvPresentation snapshot={snapshot} onExit={() => undefined} />);
    expect(screen.getByRole("heading", { name: "500 users" })).toBeDefined();
    expect(container.querySelectorAll("[data-entry-burst='active']")).toHaveLength(1);
    expect(container.querySelector("[data-takeover-effects='active']")).not.toBeNull();
  });

  it("preserves celebration canvases across polling and screen rotation", async () => {
    vi.useFakeTimers();
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-highlight");
    if (snapshot == null) throw new Error("Missing celebration Highlight fixture");

    const { container, rerender } = render(<TvPresentation snapshot={snapshot} onExit={() => undefined} />);
    const backgroundCanvas = container.querySelector("[data-celebration-layer='background']");
    const foregroundCanvas = container.querySelector("[data-celebration-layer='foreground']");
    if (backgroundCanvas == null || foregroundCanvas == null) throw new Error("Missing celebration canvases");

    rerender(<TvPresentation snapshot={{
      ...snapshot,
      generatedAt: "2026-07-23T14:32:15.000Z",
      staleAfter: "2026-07-23T14:33:00.000Z",
    }} onExit={() => undefined} />);
    await act(() => vi.advanceTimersByTime(15_000));

    expect(container.querySelector("[data-celebration-layer='background']")).toBe(backgroundCanvas);
    expect(container.querySelector("[data-celebration-layer='foreground']")).toBe(foregroundCanvas);
  });

  it("suspends ambient effects for an incident and restores an eligible celebration", () => {
    const celebration = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-highlight");
    const suspended = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-suspended");
    const resumed = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-resumed");
    const expired = getTvFixtureSnapshot("project-a", "company-pulse", "celebration-animation-expired");
    if (celebration == null || suspended == null || resumed == null || expired == null) {
      throw new Error("Missing celebration lifecycle fixtures");
    }

    const { container, rerender } = render(<TvPresentation snapshot={celebration} onExit={() => undefined} />);
    expect(container.querySelectorAll("[data-ambient-effects='active']")).toHaveLength(2);

    rerender(<TvPresentation snapshot={suspended} onExit={() => undefined} />);
    expect(container.querySelectorAll("[data-ambient-effects='active']")).toHaveLength(0);

    rerender(<TvPresentation snapshot={resumed} onExit={() => undefined} />);
    expect(container.querySelectorAll("[data-ambient-effects='active']")).toHaveLength(2);

    rerender(<TvPresentation snapshot={expired} onExit={() => undefined} />);
    expect(container.querySelectorAll("[data-ambient-effects='active']")).toHaveLength(0);
  });
});

describe("TV insight area", () => {
  it.each([
    ["live-pulse", "Comparable live-activity analysis will appear when a validated recent baseline is available."],
    ["audience-momentum", "No evidence-qualified audience lifecycle insight was identified for this seven-day window."],
    ["revenue-payments", "No evidence-qualified revenue or payment insight was identified for this 30-day window."],
    ["email-health", "No evidence-qualified email delivery insight was identified for this seven-day window."],
  ] as const)("provides a neutral ready-state explanation for %s", (screenId, message) => {
    expect(getTvInsightPresentation({
      screenId,
      sourceStatus: "ready",
      insight: null,
    })).toEqual({ message, explanatory: true });
  });

  it.each([
    ["revenue-payments", "At least 10 applicable payment attempts are required before payment health can be assessed."],
    ["email-health", "At least 20 finished sends are required before delivery health can be assessed."],
  ] as const)("explains the evidence threshold for %s", (screenId, message) => {
    expect(getTvInsightPresentation({
      screenId,
      sourceStatus: "insufficient-data",
      insight: null,
    })).toEqual({ message, explanatory: true });
  });

  it("preserves a validated structured insight for stale content", () => {
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse");
    const insight = snapshot?.screens.find((candidate) => candidate.id === "email-health")?.insight;
    if (insight == null) throw new Error("Missing Email Health fixture insight");

    expect(getTvInsightPresentation({
      screenId: "email-health",
      sourceStatus: "stale",
      insight,
    })).toEqual({ message: insight.message, explanatory: false });
  });

  it("renders the threshold explanation in the shared insight card", () => {
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse", "insufficient-data");
    const revenue = snapshot?.screens.find((candidate) => candidate.id === "revenue-payments");
    if (revenue == null) throw new Error("Missing insufficient-data Revenue fixture");

    render(renderTvScreen(revenue));

    screen.getByText("At least 10 applicable payment attempts are required before payment health can be assessed.");
  });
});
