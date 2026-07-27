// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HostedAuthMethodPreview } from "./hosted-auth-preview";

const previewProject = {
  displayName: "Preview App",
  config: {
    signUpEnabled: true,
    credentialEnabled: true,
    passkeyEnabled: false,
    magicLinkEnabled: true,
    oauthProviders: [
      { id: "google" },
      { id: "github" },
    ],
  },
};

afterEach(() => {
  cleanup();
});

describe("HostedAuthMethodPreview", () => {
  it("uses interactive hosted-style tabs and input surfaces", () => {
    render(<HostedAuthMethodPreview project={previewProject} />);

    const tabsList = screen.getByRole("tablist");
    expect(tabsList.getAttribute("class")).toContain("dark:bg-zinc-900/45");
    expect(tabsList.querySelector("[aria-hidden]")?.getAttribute("class")).toContain("dark:bg-zinc-800/80");

    // Both the magic-link and email+password tab panels render an "Email" field, so scope to the
    // magic-link input (the default active tab) to disambiguate.
    const emailInput = screen.getByLabelText("Email", { selector: "#hosted-preview-email" });
    fireEvent.change(emailInput, { target: { value: "hello@example.com" } });
    expect(emailInput).toHaveProperty("value", "hello@example.com");
    expect(emailInput.getAttribute("class")).toContain("bg-white/45");
    expect(emailInput.getAttribute("class")).toContain("dark:bg-zinc-900/50");
    expect(emailInput.getAttribute("class")).not.toContain("bg-background");

    fireEvent.click(screen.getByRole("tab", { name: "Email & Password" }));

    screen.getByLabelText("Password");
    expect(screen.getByRole("tab", { name: "Email & Password" }).getAttribute("data-state")).toBe("active");
  });

  it("explains how to fix the project instead of rendering a form when no auth method is enabled", () => {
    render(<HostedAuthMethodPreview project={{
      displayName: "Preview App",
      config: {
        signUpEnabled: true,
        credentialEnabled: false,
        passkeyEnabled: false,
        magicLinkEnabled: false,
        oauthProviders: [],
      },
    }} />);

    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    screen.getByText("Sign-in is not available");
    screen.getByText("hexclave.config.ts");
  });

  it("keeps rendering the sign-in form when only some auth methods are disabled", () => {
    render(<HostedAuthMethodPreview project={{
      displayName: "Preview App",
      config: {
        signUpEnabled: true,
        credentialEnabled: true,
        passkeyEnabled: false,
        magicLinkEnabled: false,
        oauthProviders: [],
      },
    }} />);

    screen.getByLabelText("Password");
    expect(screen.queryByText("Sign-in is not available")).toBeNull();
  });

  it("tells passkey-only projects to sign in instead of signing up, without claiming a misconfiguration", () => {
    render(<HostedAuthMethodPreview
      type="sign-up"
      project={{
        displayName: "Preview App",
        config: {
          signUpEnabled: true,
          credentialEnabled: false,
          passkeyEnabled: true,
          magicLinkEnabled: false,
          oauthProviders: [],
        },
      }}
    />);

    expect(screen.queryByText("Sign-in is not available")).toBeNull();
    screen.getByText("New accounts can't be created with the sign-in methods enabled for this app. Sign in instead.");
  });
});
