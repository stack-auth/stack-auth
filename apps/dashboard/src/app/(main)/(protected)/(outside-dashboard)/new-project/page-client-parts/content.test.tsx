// @vitest-environment jsdom

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockOwnedProjects = vi.hoisted(() => ({ current: [] as Array<{ id: string }> }));
const mockCreateProject = vi.hoisted(() => vi.fn(async () => ({ id: "created-project-id" })));
const mockWindowOpen = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("@/components/design-components", () => ({
  DesignDialog: ({ open, onOpenChange, title, description, footer, children }: {
    open?: boolean,
    onOpenChange?: (open: boolean) => void,
    title?: ReactNode,
    description?: ReactNode,
    footer?: ReactNode,
    children?: ReactNode,
  }) => open ? (
    <div>
      <button type="button" onClick={() => onOpenChange?.(false)}>dismiss dialog</button>
      <h2>{title}</h2>
      <div>{description}</div>
      {children}
      {footer}
    </div>
  ) : null,
}));

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
  useSearchParams: () => mockSearchParams.current,
}));

vi.mock("./project-onboarding-wizard", () => ({
  ProjectOnboardingWizard: () => <div>Onboarding wizard</div>,
}));

vi.mock("./components", () => ({
  NewProjectEntryPage: ({ onSelect }: { onSelect: (choice: "setup-new" | "deploy") => void }) => (
    <div>
      <h1>Welcome to Hexclave!</h1>
      <button type="button" onClick={() => onSelect("setup-new")}>Set up Hexclave in a project</button>
      <button type="button" onClick={() => onSelect("deploy")}>Deploy my Hexclave project to production</button>
      <button type="button" onClick={() => window.open("https://preview.hexclave.com", "_blank", "noopener,noreferrer")}>
        I just want to look around
      </button>
    </div>
  ),
  SetupNewProjectPage: ({ onBack }: { onBack: () => void }) => (
    <div>
      <h1>Set up Hexclave in a project</h1>
      <button type="button" onClick={onBack}>Go back</button>
    </div>
  ),
}));

import PageClient from "./content";

afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockOwnedProjects.current = [];
  mockCreateProject.mockReset();
  mockCreateProject.mockResolvedValue({ id: "created-project-id" });
  mockWindowOpen.mockReset();
  mockSearchParams.current = new URLSearchParams();
  window.open = mockWindowOpen;
});

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
  it("does not create a project before the user chooses what to do", () => {
    render(<PageClient />);

    expect(screen.getByText("Welcome to Hexclave!")).not.toBeNull();
    expect(screen.queryByText("Name your project")).toBeNull();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("shows the setup prompt without creating a project", () => {
    render(<PageClient />);

    fireEvent.click(screen.getByText("Set up Hexclave in a project"));

    expect(mockReplace).toHaveBeenCalledWith("/new-project?mode=setup-new");
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Name your project")).toBeNull();
  });

  it("renders the setup prompt from the setup-new mode without a project", () => {
    mockSearchParams.current = new URLSearchParams("mode=setup-new");
    render(<PageClient />);

    expect(screen.getByText("Set up Hexclave in a project")).not.toBeNull();
    expect(screen.getByText("Go back")).not.toBeNull();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("creates a deploy project only after the name and team form is submitted", async () => {
    const { container } = render(<PageClient />);

    fireEvent.click(screen.getByText("Deploy my Hexclave project to production"));
    expect(screen.getByText("Name your project")).not.toBeNull();
    expect(mockCreateProject).not.toHaveBeenCalled();

    fireEvent.change(container.querySelector("#project-name") ?? throwMissingInput(), { target: { value: "Deploy Project" } });
    fireEvent.submit(container.querySelector("form") ?? throwMissingForm());

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        displayName: "Deploy Project",
        teamId: "team-id",
        onboardingStatus: "config_choice",
      });
      expect(mockReplace).toHaveBeenCalledWith("/new-project?project_id=created-project-id&mode=deploy");
    });
  });

  it("opens the name dialog immediately for integration create flows", () => {
    mockSearchParams.current = new URLSearchParams("display_name=Neon+App&redirect_to_neon_confirm_with=foo%3D1");
    render(<PageClient />);

    expect(screen.getByText("Name your project")).not.toBeNull();
    expect((screen.getByDisplayValue("Neon App") as HTMLInputElement).value).toBe("Neon App");
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("opens the preview without creating a project", () => {
    render(<PageClient />);

    fireEvent.click(screen.getByText("I just want to look around"));

    expect(mockWindowOpen).toHaveBeenCalledWith("https://preview.hexclave.com", "_blank", "noopener,noreferrer");
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Name your project")).toBeNull();
  });

  it("returns to Welcome when the project dialog is dismissed", () => {
    render(<PageClient />);

    fireEvent.click(screen.getByText("Deploy my Hexclave project to production"));
    dismissCreateProjectDialog();

    expect(screen.getByText("Welcome to Hexclave!")).not.toBeNull();
    expect(screen.queryByText("Name your project")).toBeNull();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("ignores dismissals while a project is being created", () => {
    mockCreateProject.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PageClient />);

    fireEvent.click(screen.getByText("Deploy my Hexclave project to production"));
    fireEvent.change(container.querySelector("#project-name") ?? throwMissingInput(), { target: { value: "My Project" } });
    fireEvent.submit(container.querySelector("form") ?? throwMissingForm());
    dismissCreateProjectDialog();

    expect(screen.getByText("Name your project")).not.toBeNull();
  });
});
