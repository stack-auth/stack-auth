// @vitest-environment jsdom

import type { ButtonHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();

  type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string,
  };

  return {
    ...actual,
    Button: ({ children, type, variant: _variant, ...props }: MockButtonProps) => (
      <button type={type ?? "button"} {...props}>
        {children}
      </button>
    ),
  };
});

import { TooltipProvider } from "@/components/ui";

import {
  beginPendingAction,
  DomainSetupTransitionState,
  endPendingAction,
  OnboardingAppCard,
  OnboardingPage,
} from "./page-client";

afterEach(() => {
  cleanup();
});

describe("beginPendingAction", () => {
  it("blocks duplicate starts until the action finishes", () => {
    const pendingRef = { current: false };
    const setPending = vi.fn();

    expect(beginPendingAction(pendingRef, setPending)).toBe(true);
    expect(beginPendingAction(pendingRef, setPending)).toBe(false);
    expect(setPending.mock.calls).toEqual([[true]]);

    endPendingAction(pendingRef, setPending);

    expect(pendingRef.current).toBe(false);
    expect(setPending.mock.calls).toEqual([[true], [false]]);
  });
});

describe("OnboardingPage", () => {
  it("uses hover-exit-only transitions and accessible labels for progress dots", () => {
    render(
      <OnboardingPage
        stepKey="apps-selection"
        title="Select apps"
        steps={[
          { id: "config_choice", label: "Config" },
          { id: "apps_selection", label: "Apps" },
        ]}
        currentStep="apps_selection"
        onStepClick={vi.fn()}
        primaryAction={<button type="button">Continue</button>}
      >
        <div>Step body</div>
      </OnboardingPage>,
    );

    const completedStepButton = screen.getByRole("button", { name: "Go to step: Config" });
    const currentStepButton = screen.getByRole("button", { name: "Apps" });
    const className = completedStepButton.getAttribute("class") ?? "";

    expect(className).toContain("transition-colors");
    expect(className).toContain("hover:transition-none");
    expect(currentStepButton.getAttribute("aria-current")).toBe("step");
  });
});

describe("OnboardingAppCard", () => {
  it("marks required cards as non-keyboard-interactive", () => {
    const onToggle = vi.fn();

    render(
      <TooltipProvider>
        <OnboardingAppCard
          appId="authentication"
          selected
          required
          primary
          onToggle={onToggle}
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("DomainSetupTransitionState", () => {
  it("shows a retryable fallback when auto-advance fails", () => {
    const onRetry = vi.fn();
    const onOpenProject = vi.fn();

    render(
      <DomainSetupTransitionState
        advancing={false}
        errorMessage="Network request failed."
        onRetry={onRetry}
        onOpenProject={onOpenProject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Project" }));

    expect(screen.getByText("Domain setup transition failed")).toBeTruthy();
    expect(screen.getByText("Network request failed.")).toBeTruthy();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });
});
