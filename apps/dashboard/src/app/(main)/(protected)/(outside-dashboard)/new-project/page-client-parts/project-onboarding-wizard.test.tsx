// @vitest-environment jsdom

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
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
  Skeleton: ({ children, ...props }: { children?: ReactNode } & HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
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

vi.mock("@hexclave/next", () => ({
  AdminOwnedProject: class {},
  AuthPage: () => <div>Auth preview</div>,
}));

vi.mock("@hexclave/shared/dist/utils/oauth", () => ({
  allProviders: ["google", "github", "microsoft", "spotify"],
  sharedProviders: ["google", "github", "microsoft", "spotify"],
}));

vi.mock("@hexclave/shared/dist/utils/promises", () => ({
  runAsynchronously: (promiseOrFn: Promise<unknown> | (() => Promise<unknown>)) => (
    typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn
  ),
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
import { ALL_APPS, getParentAppId, type AppId } from "@hexclave/shared/dist/apps/apps-config";

afterEach(() => {
  cleanup();
  mockUpdateConfig.mockClear();
});

function createDeferred<T>() {
  let resolveDeferred: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Deferred promise was resolved before initialization.");
  };
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return {
    promise,
    resolve: resolveDeferred,
  };
}

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

  it("preserves OAuth sign-in methods when developmentEnvironment is true but isLocalEmulator is false (RDE)", () => {
    const normalizedState = normalizeProjectOnboardingState({
      selected_config_choice: "create-new",
      selected_apps: [],
      selected_sign_in_methods: ["credential", "google", "github"],
      selected_email_theme_id: null,
      selected_payments_country: "US",
    }, { developmentEnvironment: true, isLocalEmulator: false });

    expect(normalizedState.selected_sign_in_methods).toContain("google");
    expect(normalizedState.selected_sign_in_methods).toContain("github");
  });

  it("strips OAuth sign-in methods when isLocalEmulator is true", () => {
    const normalizedState = normalizeProjectOnboardingState({
      selected_config_choice: "create-new",
      selected_apps: [],
      selected_sign_in_methods: ["credential", "google", "github", "microsoft"],
      selected_email_theme_id: null,
      selected_payments_country: "US",
    }, { developmentEnvironment: true, isLocalEmulator: true });

    expect(normalizedState.selected_sign_in_methods).toContain("credential");
    expect(normalizedState.selected_sign_in_methods).not.toContain("google");
    expect(normalizedState.selected_sign_in_methods).not.toContain("github");
    expect(normalizedState.selected_sign_in_methods).not.toContain("microsoft");
  });

  it("does not offer alpha apps during app selection", () => {
    const alphaAppIds = Object.entries(ALL_APPS)
      .filter(([, app]) => app.stage === "alpha")
      .map(([appId]) => appId);

    for (const alphaAppId of alphaAppIds) {
      expect(orderedAppIds()).not.toContain(alphaAppId);
    }
  });

  it("does not offer sub-apps during app selection", () => {
    const subAppIds = (Object.keys(ALL_APPS) as AppId[]).filter((appId) => getParentAppId(appId) != null);

    for (const subAppId of subAppIds) {
      expect(orderedAppIds()).not.toContain(subAppId);
    }
  });

  it("prefetches email themes on early steps without mounting heavy hooks", () => {
    const useEmailThemes = vi.fn(() => {
      throw new Error("Email themes should not load on the app selection step.");
    });
    const useStripeAccountInfo = vi.fn(() => {
      throw new Error("Stripe account info should not load on the app selection step.");
    });
    const listEmailThemes = vi.fn(async () => []);
    const getStripeAccountInfo = vi.fn(async () => null);

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes,
            getStripeAccountInfo,
            useEmailThemes,
            useStripeAccountInfo,
          },
        } as never}
        status="apps_selection"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    expect(listEmailThemes).toHaveBeenCalledOnce();
    expect(getStripeAccountInfo).not.toHaveBeenCalled();
    expect(useEmailThemes).not.toHaveBeenCalled();
    expect(useStripeAccountInfo).not.toHaveBeenCalled();
  });

  it("saves app selection state and status in one request", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="apps_selection"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledOnce();
    });
    expect(saveOnboardingProgress).toHaveBeenCalledWith({
      status: "auth_setup",
      onboardingState: expect.objectContaining({
        selected_apps: expect.arrayContaining(["authentication", "emails", "payments"]),
      }),
    });
  });

  it("saves auth setup state and status in one request", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});

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
          app: {
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="auth_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledOnce();
    });
    expect(saveOnboardingProgress).toHaveBeenCalledWith({
      status: "email_theme_setup",
      onboardingState: expect.objectContaining({
        selected_sign_in_methods: expect.arrayContaining(["credential"]),
      }),
    });
  });

  it("saves email theme state and status in one request", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [{ id: "default", displayName: "Default" }],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="email_theme_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledOnce();
    });
    expect(saveOnboardingProgress).toHaveBeenCalledWith({
      status: "payments_setup",
      onboardingState: expect.objectContaining({
        selected_email_theme_id: "default",
      }),
    });
  });

  it("prefetches Stripe account info on the email theme step without mounting the payments hook", () => {
    const getStripeAccountInfo = vi.fn(async () => null);
    const useStripeAccountInfo = vi.fn(() => {
      throw new Error("Stripe account info should not load before the payments step.");
    });

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo,
            useEmailThemes: () => [{ id: "default", displayName: "Default" }],
            useStripeAccountInfo,
          },
        } as never}
        status="email_theme_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    expect(getStripeAccountInfo).toHaveBeenCalledOnce();
    expect(useStripeAccountInfo).not.toHaveBeenCalled();
  });

  it("shows an email-theme shimmer instead of the page spinner while themes load", () => {
    const pendingEmailThemes = new Promise<never>(() => {});

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => {
              throw pendingEmailThemes;
            },
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="email_theme_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Select an email theme")).toBeTruthy();
    expect(screen.getByTestId("email-theme-step-skeleton")).toBeTruthy();
  });

  it("shows a payments shimmer instead of the page spinner while Stripe status loads", () => {
    const pendingStripeAccountInfo = new Promise<never>(() => {});

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
            setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => {
              throw pendingStripeAccountInfo;
            },
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Set up payments")).toBeTruthy();
    expect(screen.getByTestId("payments-setup-step-skeleton")).toBeTruthy();
  });

  it("completes onboarding automatically after Stripe setup returns successfully", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});
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
        listEmailThemes: vi.fn(async () => []),
        getStripeAccountInfo: vi.fn(async () => null),
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
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledWith({
        status: "welcome",
        onboardingState: expect.objectContaining({
          selected_payments_country: "US",
        }),
      });
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("creates a deferred Stripe account when payments setup is deferred for a US project", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});
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
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Do Later"));

    await waitFor(() => {
      expect(setupPayments).toHaveBeenCalledOnce();
    });
    expect(saveOnboardingProgress).toHaveBeenCalledWith({
      status: "welcome",
      onboardingState: expect.objectContaining({
        selected_payments_country: "US",
      }),
    });
  });

  it("does not create a Stripe account when payments setup is deferred for an unsupported country", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});
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
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
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
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Do Later"));

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledWith({
        status: "welcome",
        onboardingState: expect.objectContaining({
          selected_payments_country: "OTHER",
        }),
      });
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
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
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
            listEmailThemes: vi.fn(async () => []),
            getStripeAccountInfo: vi.fn(async () => null),
            useEmailThemes: () => [],
            useStripeAccountInfo: () => null,
          },
        } as never}
        status="payments_setup"
        onboardingState={null}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={vi.fn(async () => {})}
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
    const saveOnboardingProgress = vi.fn(async () => {});
    const onComplete = vi.fn();
    const app = {
      setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
      listEmailThemes: vi.fn(async () => []),
      getStripeAccountInfo: vi.fn(async () => null),
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
      getPushedConfigSource: vi.fn(async () => ({ type: "unlinked" })),
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
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(2);
      expect(mockUpdateConfig).toHaveBeenNthCalledWith(1, {
        adminApp: app,
        configUpdate: expect.objectContaining({
          "auth.password.allowSignIn": true,
          "apps.installed.authentication.enabled": true,
          "apps.installed.emails.enabled": true,
        }),
        pushable: true,
      });
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
    });
    expect(saveOnboardingProgress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledWith({ status: "completed", onboardingState: null });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("waits for the in-flight welcome config save before marking onboarding completed", async () => {
    const saveOnboardingProgress = vi.fn(async () => {});
    const onComplete = vi.fn();
    const branchConfigSave = createDeferred<boolean>();
    const environmentConfigSave = createDeferred<boolean>();
    mockUpdateConfig.mockImplementationOnce(async () => await branchConfigSave.promise);
    mockUpdateConfig.mockImplementationOnce(async () => await environmentConfigSave.promise);
    const app = {
      setupPayments: vi.fn(async () => ({ url: "https://example.com" })),
      listEmailThemes: vi.fn(async () => []),
      getStripeAccountInfo: vi.fn(async () => null),
      useEmailThemes: () => [],
      useStripeAccountInfo: () => null,
    };

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
          getPushedConfigSource: vi.fn(async () => ({ type: "unlinked" })),
        } as never}
        status="welcome"
        onboardingState={{
          selected_config_choice: "create-new",
          selected_apps: ["authentication", "emails"],
          selected_sign_in_methods: ["credential"],
          selected_email_theme_id: "default",
          selected_payments_country: "US",
        }}
        mode={null}
        setMode={vi.fn()}
        saveOnboardingProgress={saveOnboardingProgress}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledOnce();
    });

    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));

    await Promise.resolve();
    expect(saveOnboardingProgress).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    branchConfigSave.resolve(true);

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(2);
    });
    expect(saveOnboardingProgress).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    environmentConfigSave.resolve(true);

    await waitFor(() => {
      expect(saveOnboardingProgress).toHaveBeenCalledWith({ status: "completed", onboardingState: null });
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
