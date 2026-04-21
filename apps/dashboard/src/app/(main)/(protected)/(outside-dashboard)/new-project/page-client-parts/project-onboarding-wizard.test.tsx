// @vitest-environment jsdom

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/components/design-components", () => ({
  DesignCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DesignPillToggle: () => <div />,
}));

vi.mock("@/components/design-components/alert", () => ({
  DesignAlert: ({ title, description }: { title: string, description: string }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}));

vi.mock("@/components/design-components/button", () => ({
  DesignButton: ({
    children,
    type,
    loading: _loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean, variant?: string }) => (
    <button type={type ?? "button"} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/design-components/select", () => ({
  DesignSelectorDropdown: ({
    value,
    onValueChange,
    options,
  }: {
    value: string,
    onValueChange: (value: string) => void,
    options: Array<{ value: string, label: string }>,
  }) => (
    <select
      aria-label="selector"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/components/stripe-wordmark", () => ({
  StripeWordmark: () => <div>Stripe</div>,
}));

vi.mock("@/components/ui", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BrowserFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type ?? "button"} {...props}>{children}</button>
  ),
  Switch: () => <button type="button">switch</button>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Typography: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  cn: (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(" "),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: () => "false",
}));

vi.mock("@/lib/config-update", () => ({
  useUpdateConfig: () => vi.fn(async () => true),
}));

vi.mock("@stackframe/stack", () => ({
  AdminOwnedProject: class {},
  AuthPage: () => <div>Auth preview</div>,
}));

vi.mock("@stackframe/stack-shared/dist/utils/oauth", () => ({
  allProviders: [],
}));

vi.mock("@stackframe/stack-shared/dist/utils/promises", () => ({
  runAsynchronouslyWithAlert: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("./components", () => ({
  DomainSetupTransitionState: () => <div>Domain setup transition</div>,
  ModeNotImplementedCard: () => <div>Mode not implemented</div>,
  OnboardingAppCard: () => <div>App card</div>,
  OnboardingEmailThemePreview: () => <div>Email theme preview</div>,
  OnboardingPage: ({
    title,
    subtitle,
    children,
    primaryAction,
    secondaryAction,
  }: {
    title: string,
    subtitle?: string,
    children: ReactNode,
    primaryAction: ReactNode,
    secondaryAction?: ReactNode,
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle != null && <p>{subtitle}</p>}
      <div>{children}</div>
      <div>{primaryAction}</div>
      <div>{secondaryAction}</div>
    </div>
  ),
  WelcomeSlide: ({ onFinish }: { onFinish: () => void }) => (
    <div>
      <h1>Welcome to Stack Auth</h1>
      <button type="button" onClick={onFinish}>Get Started</button>
    </div>
  ),
}));

vi.mock("./link-existing-onboarding", () => ({
  LinkExistingOnboarding: () => <div>Link existing onboarding</div>,
}));

import { ProjectOnboardingWizard } from "./project-onboarding-wizard";

afterEach(() => {
  cleanup();
});

describe("ProjectOnboardingWizard", () => {
  it("completes onboarding automatically after Stripe setup returns successfully", async () => {
    const setStatus = vi.fn(async () => {});
    const onComplete = vi.fn();

    const project = {
      id: "proj_123",
      config: {
        credentialEnabled: true,
        magicLinkEnabled: false,
        passkeyEnabled: false,
        oauthProviders: [],
      },
      useConfig: () => ({
        apps: {
          installed: {
            authentication: { enabled: true },
            emails: { enabled: true },
            payments: { enabled: true },
          },
        },
        domains: {
          trustedDomains: {},
        },
        emails: {
          selectedThemeId: "default",
          server: {},
        },
      }),
      app: {
        setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
        useEmailThemes: () => [],
        useStripeAccountInfo: () => ({
          account_id: "acct_123",
          charges_enabled: true,
          details_submitted: true,
          payouts_enabled: true,
        }),
      },
    };

    render(
      <ProjectOnboardingWizard
        project={project as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        setStatus={setStatus}
        setOnboardingState={vi.fn(async () => {})}
        clearOnboardingState={vi.fn(async () => {})}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith("welcome");
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
