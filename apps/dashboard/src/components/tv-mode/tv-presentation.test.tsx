// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTvFixtureSnapshot } from "@/lib/tv-mode/fixtures";
import { renderTvScreen } from "./screen-registry";
import { TvPresentation } from "./tv-presentation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TvPresentation rotation", () => {
  it("does not restart rotation or reset the current screen when polling replaces the snapshot", () => {
    vi.useFakeTimers();
    const snapshot = getTvFixtureSnapshot("project-a", "company-pulse");
    if (snapshot == null) throw new Error("Missing company-pulse fixture");
    const { rerender } = render(
      <TvPresentation snapshot={snapshot} onExit={() => undefined} />,
    );

    screen.getByRole("heading", { name: "Live Pulse" });
    act(() => vi.advanceTimersByTime(15_000));

    const refreshedSnapshot = {
      ...snapshot,
      generatedAt: "2026-07-23T14:32:15.000Z",
      staleAfter: "2026-07-23T14:33:00.000Z",
    };
    rerender(<TvPresentation snapshot={refreshedSnapshot} onExit={() => undefined} />);

    act(() => vi.advanceTimersByTime(5_000));
    screen.getByLabelText("Screen 2 of 4");

    act(() => vi.advanceTimersByTime(15_000));
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

    screen.getByLabelText("Screen 2 of 4");
    act(() => vi.advanceTimersByTime(5_000));
    screen.getByLabelText("Screen 3 of 4");
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

    screen.getByText(title);
    screen.getByText(subtitle);
  });
});
