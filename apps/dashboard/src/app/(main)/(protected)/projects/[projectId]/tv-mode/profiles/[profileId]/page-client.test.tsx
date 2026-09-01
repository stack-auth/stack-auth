// @vitest-environment jsdom

import { getTvBuiltInProfile } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ projectId: "project-a" }));
const fetchTvProfile = vi.hoisted(() => vi.fn());
const testAdminApp = vi.hoisted(() => ({
  useProject: () => ({ displayName: "Test Project" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => `/projects/${testState.projectId}/tv-mode/profiles/company-pulse`,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/design-components", () => ({
  DesignAlert: ({ title }: { title: string }) => <div>{title}</div>,
  DesignButton: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  DesignCard: ({ title, children }: { title: string, children: ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  DesignInput: (props: ComponentProps<"input">) => <input {...props} />,
  DesignSelectorDropdown: ({
    triggerId,
    value,
    onValueChange,
    options,
    disabled,
  }: {
    triggerId?: string,
    value: string,
    onValueChange: (value: string) => void,
    options: Array<{ value: string, label: string }>,
    disabled?: boolean,
  }) => (
    <select
      aria-label={triggerId ?? `setting-${value}`}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock("@/components/link", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/components/router", () => ({
  useRouterConfirm: () => ({ setNeedConfirm: vi.fn() }),
}));

vi.mock("@/components/ui", () => ({
  Typography: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ "aria-label": ariaLabel, disabled }: { "aria-label"?: string, disabled?: boolean }) => (
    <button type="button" aria-label={ariaLabel} disabled={disabled} />
  ),
}));

vi.mock("@/components/tv-mode/tv-presentation", () => ({
  TvPresentation: () => <div>TV presentation</div>,
}));

vi.mock("@/components/tv-mode/presentation-window", () => ({
  useTvPresentationLauncher: () => ({ launchPresentation: vi.fn(), popupBlocked: false }),
}));

vi.mock("@/components/tv-mode/screen-registry", () => ({
  getTvScreenDefinition: (screenId: string) => ({
    displayName: screenId,
    description: `${screenId} description`,
    accentClassName: "",
    icon: () => <span />,
  }),
}));

vi.mock("@/lib/tv-mode/fixtures", () => ({
  createTvFixtureSnapshot: () => null,
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  createTvProfileOrThrow: vi.fn(),
  deleteTvProfileOrThrow: vi.fn(),
  duplicateTvProfileOrThrow: vi.fn(),
  fetchTvProfileOrThrow: fetchTvProfile,
  TvProfileRequestError: class TvProfileRequestError extends Error {},
  updateTvProfileOrThrow: vi.fn(),
}));

vi.mock("../../../page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("../../../use-admin-app", () => ({
  useAdminApp: () => testAdminApp,
  useProjectId: () => testState.projectId,
}));

vi.mock("./tv-profile-delete-dialog", () => ({
  TvProfileDeleteDialog: () => null,
}));

import PageClient from "./page-client";

beforeEach(() => {
  testState.projectId = "project-a";
  fetchTvProfile.mockReset();
  const profile = getTvBuiltInProfile("company-pulse");
  if (profile == null) throw new Error("Missing company-pulse profile fixture");
  fetchTvProfile.mockResolvedValue(profile);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TV profile editor layout", () => {
  it("shows one timing category at a time with Celebrations selected by default", async () => {
    render(<PageClient />);

    const timingSelector = await screen.findByLabelText("tv-presentation-timing");
    expect(screen.getByText("Celebration Takeover")).toBeDefined();
    expect(screen.queryByText("Incident Takeover")).toBeNull();

    fireEvent.change(timingSelector, { target: { value: "incident" } });

    expect(screen.getByText("Incident Takeover")).toBeDefined();
    expect(screen.queryByText("Celebration Takeover")).toBeNull();
  });

  it("shows developer previews only for development-enabled projects", async () => {
    const customerRender = render(<PageClient />);
    await screen.findByText("Timing");
    expect(screen.queryByText("Event Previews")).toBeNull();
    expect(screen.queryByText("State Previews")).toBeNull();
    customerRender.unmount();

    testState.projectId = "internal";
    render(<PageClient />);
    expect(await screen.findByText("Event Previews")).toBeDefined();
    expect(screen.getByText("State Previews")).toBeDefined();
  });
});
