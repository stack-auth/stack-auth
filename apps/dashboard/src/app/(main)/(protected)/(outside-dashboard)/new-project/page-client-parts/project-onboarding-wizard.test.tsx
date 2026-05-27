// @vitest-environment jsdom

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockUpdateConfig = vi.hoisted(() => vi.fn(async () => true));

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
    loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean, variant?: string }) => (
    <button type={type ?? "button"} data-loading={loading ? "true" : "false"} {...props}>{children}</button>
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
  useUpdateConfig: () => mockUpdateConfig,
}));

vi.mock("@stackframe/stack", () => ({
  AdminOwnedProject: class {},
  AuthPage: () => <div>Auth preview</div>,
}));

vi.mock("@stackframe/stack-shared/dist/utils/oauth", () => ({
  allProviders: ["google", "github", "microsoft", "spotify"],
  sharedProviders: ["google", "github", "microsoft", "spotify"],
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
      <h1>Welcome to Hexclave</h1>
      <button type="button" onClick={onFinish}>Get Started</button>
    </div>
  ),
}));

vi.mock("./link-existing-onboarding", () => ({
  LinkExistingOnboarding: () => <div>Link existing onboarding</div>,
}));

import { ProjectOnboardingWizard } from "./project-onboarding-wizard";
import { normalizeProjectOnboardingState, orderedAppIds, REQUIRED_APP_IDS } from "./shared";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";

afterEach(() => {
  cleanup();
  mockUpdateConfig.mockClear();
});

describe("ProjectOnboardingWizard", () => {
  it("keeps required apps when normalizing persisted onboarding state", () => {
    const normalizedState = normalizeProjectOnboardingState({
      selected_config_choice: "create-new",
      selected_apps: [],
      selected_sign_in_methods: [],
      selected_email_theme_id: null,
      selected_payments_country: "US",
    });

    expect(normalizedState.selected_apps).toEqual(REQUIRED_APP_IDS);
  });

  it("does not offer alpha apps during app selection", () => {
    const alphaAppIds = Object.entries(ALL_APPS)
      .filter(([, app]) => app.stage === "alpha")
      .map(([appId]) => appId);

    for (const alphaAppId of alphaAppIds) {
      expect(orderedAppIds()).not.toContain(alphaAppId);
    }
  });

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

  it("creates a deferred Stripe account when payments setup is deferred for a US project", async () => {
    const setStatus = vi.fn(async () => {});
    const setOnboardingState = vi.fn(async () => {});
    const setupPayments = vi.fn(async () => ({ url: "https://example.com" }));

    render(
      <ProjectOnboardingWizard
        project={{
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
            setupPayments,
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        setStatus={setStatus}
        setOnboardingState={setOnboardingState}
        clearOnboardingState={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Do Later"));

    await waitFor(() => {
      expect(setupPayments).toHaveBeenCalledOnce();
    });
    expect(setOnboardingState).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith("welcome");
  });

  it("does not create a Stripe account when payments setup is deferred for an unsupported country", async () => {
    const setStatus = vi.fn(async () => {});
    const setupPayments = vi.fn(async () => ({ url: "https://example.com" }));

    render(
      <ProjectOnboardingWizard
        project={{
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
            setupPayments,
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={{
          selected_config_choice: "create-new",
          selected_apps: ["authentication", "emails", "payments"],
          selected_sign_in_methods: ["credential"],
          selected_email_theme_id: "default",
          selected_payments_country: "OTHER",
        }}
        mode={null}
        setMode={vi.fn()}
        setStatus={setStatus}
        setOnboardingState={vi.fn(async () => {})}
        clearOnboardingState={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Do Later"));

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith("welcome");
    });
    expect(setupPayments).not.toHaveBeenCalled();
  });

  it("only shows a loading indicator on the deferred payments action while disabling connect", async () => {
    const setupPayments = vi.fn(() => new Promise<{ url: string }>(() => {}));

    render(
      <ProjectOnboardingWizard
        project={{
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
            setupPayments,
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        setStatus={vi.fn(async () => {})}
        setOnboardingState={vi.fn(async () => {})}
        clearOnboardingState={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Do Later" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Do Later" }).getAttribute("data-loading")).toBe("true");
    });
    expect(screen.getByRole("button", { name: "Do Later" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Connect" }).getAttribute("data-loading")).toBe("false");
  });

  it("only shows a loading indicator on the connect payments action while disabling defer", async () => {
    const setupPayments = vi.fn(() => new Promise<{ url: string }>(() => {}));

    render(
      <ProjectOnboardingWizard
        project={{
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
            setupPayments,
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        setStatus={vi.fn(async () => {})}
        setOnboardingState={vi.fn(async () => {})}
        clearOnboardingState={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect" }).getAttribute("data-loading")).toBe("true");
    });
    expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Do Later" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Do Later" }).getAttribute("data-loading")).toBe("false");
  });

  it("persists shared OAuth providers selected during onboarding before completing", async () => {
    const setStatus = vi.fn(async () => {});
    const clearOnboardingState = vi.fn(async () => {});
    const onComplete = vi.fn();
    const app = {
      setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
      useEmailThemes: () => [],
      useStripeAccountInfo: () => null,
    };
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
            payments: { enabled: false },
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
      app,
    };

    render(
      <ProjectOnboardingWizard
        project={project as never}
        status="welcome"
        onboardingState={{
          selected_config_choice: "create-new",
          selected_apps: ["authentication", "emails"],
          selected_sign_in_methods: ["credential", "google"],
          selected_email_theme_id: "default",
          selected_payments_country: "US",
        }}
        mode={null}
        setMode={vi.fn()}
        setStatus={setStatus}
        setOnboardingState={vi.fn(async () => {})}
        clearOnboardingState={clearOnboardingState}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(2);
      expect(mockUpdateConfig).toHaveBeenNthCalledWith(2, {
        adminApp: app,
        configUpdate: {
          "auth.oauth.providers.google": {
            type: "google",
            isShared: true,
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
          "auth.oauth.providers.github": null,
          "auth.oauth.providers.microsoft": null,
        },
        pushable: false,
      });
      expect(setStatus).toHaveBeenCalledWith("completed");
      expect(clearOnboardingState).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
