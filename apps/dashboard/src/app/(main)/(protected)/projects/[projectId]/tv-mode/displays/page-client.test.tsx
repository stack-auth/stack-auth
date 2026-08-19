// @vitest-environment jsdom

import { getTvBuiltInProfile } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { Toaster, TooltipProvider } from "@/components/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageClient from "./page-client";

const testState = vi.hoisted(() => ({
  adminApp: {},
  writeText: vi.fn(),
}));

vi.mock("../../use-admin-app", () => ({
  useAdminApp: () => testState.adminApp,
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  fetchTvProfilesOrThrow: async () => {
    const template = getTvBuiltInProfile("company-pulse");
    if (template == null) throw new Error("Company Pulse profile is missing.");
    return {
      savedProfiles: [],
      templates: [template],
      persistenceReady: true,
      effectiveDefaultProfileId: "company-pulse",
    };
  },
}));

vi.mock("@/lib/tv-mode/display-url", () => ({
  getConfiguredTvDisplayUrl: () => "http://localhost:8101/tv",
  isLocalTvDisplayUrl: () => true,
}));

vi.mock("../display-management", () => ({
  TvDisplayManagement: ({ profiles }: { profiles: unknown[] }) => <div>Display management for {profiles.length} profile</div>,
}));

afterEach(() => {
  cleanup();
  testState.writeText.mockReset();
});

describe("TV displays page", () => {
  it("loads profiles and exposes the independent display link", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: testState.writeText },
    });
    testState.writeText.mockResolvedValue(undefined);

    render(<><TooltipProvider><PageClient /></TooltipProvider><Toaster /></>);

    expect(await screen.findByText("Display management for 1 profile")).toBeTruthy();
    const openLink = screen.getByRole("link", { name: "Open TV Display" });
    expect(openLink.getAttribute("href")).toBe("http://localhost:8101/tv");
    expect(screen.getByText("Local Development Link")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy TV display link" }));
    await waitFor(() => expect(testState.writeText).toHaveBeenCalledWith("http://localhost:8101/tv"));
    expect(screen.getByText("TV Link Copied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy TV Link" })).toBeNull();
  });
});
