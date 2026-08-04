// @vitest-environment jsdom

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockOwnedProjects = vi.hoisted(() => ({ current: [] as Array<{ id: string }> }));
const mockCreateProject = vi.hoisted(() => vi.fn(async () => ({ id: "created-project-id" })));

vi.mock("@/components/design-components/button", () => ({
  DesignButton: ({ children, type, loading: _loading, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean, variant?: string }) => (
    <button type={type ?? "button"} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/design-components/input", () => ({
  DesignInput: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/design-components/select", () => ({
  DesignSelectorDropdown: ({ value, onValueChange, options }: {
    value: string,
    onValueChange: (value: string) => void,
    options: Array<{ value: string, label: string }>,
  }) => (
    <select aria-label="team" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock("@/components/router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// The dialog primitive is replaced by a minimal stand-in that renders its children only while
// open and exposes a button to trigger the same `onOpenChange(false)` that clicking the overlay
// (or pressing escape) would.
vi.mock("@/components/ui", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ children, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type={type ?? "button"} {...props}>{children}</button>
    ),
    Card: passthrough,
    CardContent: passthrough,
    CardDescription: passthrough,
    CardHeader: passthrough,
    CardTitle: passthrough,
    Dialog: ({ open, onOpenChange, children }: { open: boolean, onOpenChange?: (open: boolean) => void, children: ReactNode }) => (
      <div>
        <button type="button" onClick={() => onOpenChange?.(false)}>dismiss dialog</button>
        {open ? children : null}
      </div>
    ),
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Label: ({ children }: { children?: ReactNode }) => <label>{children}</label>,
    Spinner: () => <div>Loading</div>,
    Typography: passthrough,
  };
});

vi.mock("@/lib/dashboard-user", () => ({
  useDashboardInternalUser: () => ({
    selectedTeam: null,
    useTeams: () => [{ id: "team-id", displayName: "Team" }],
    useOwnedProjects: () => mockOwnedProjects.current,
    createProject: mockCreateProject,
    createTeam: vi.fn(),
    setSelectedTeam: vi.fn(),
  }),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: () => "false",
}));

vi.mock("@hexclave/next", () => ({}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./project-onboarding-wizard", () => ({
  ProjectOnboardingWizard: () => <div>Onboarding wizard</div>,
}));

import PageClient from "./content";

afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockOwnedProjects.current = [];
  mockCreateProject.mockReset();
  mockCreateProject.mockResolvedValue({ id: "created-project-id" });
});

// The page renders both the create-project and the create-team dialog, in that order.
function dismissCreateProjectDialog() {
  fireEvent.click(screen.getAllByText("dismiss dialog")[0]);
}

function throwMissingInput(): never {
  throw new Error("The project name input was not rendered.");
}

function throwMissingForm(): never {
  throw new Error("The project creation form was not rendered.");
}

describe("new project page", () => {
  it("keeps the creation dialog open when a user without projects dismisses it", () => {
    render(<PageClient />);
    expect(screen.getByText("Create a new project")).not.toBeNull();

    dismissCreateProjectDialog();

    // Leaving would bounce the user right back here from the projects page, which previously
    // left the page blank because the dialog stayed closed across the round trip.
    expect(screen.getByText("Create a new project")).not.toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("ignores dismissals while a project is being created", () => {
    mockOwnedProjects.current = [{ id: "project-id" }];
    mockCreateProject.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PageClient />);

    fireEvent.change(container.querySelector("#project-name") ?? throwMissingInput(), { target: { value: "My Project" } });
    fireEvent.submit(container.querySelector("form") ?? throwMissingForm());

    dismissCreateProjectDialog();

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Create a new project")).not.toBeNull();
  });

  it("returns users with projects to the projects page when they dismiss the dialog", () => {
    mockOwnedProjects.current = [{ id: "project-id" }];
    render(<PageClient />);

    dismissCreateProjectDialog();

    expect(mockPush).toHaveBeenCalledWith("/projects");
    expect(screen.getByText("Cancel")).not.toBeNull();
  });
});
