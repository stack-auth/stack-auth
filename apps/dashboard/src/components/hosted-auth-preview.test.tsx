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

    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "hello@example.com" } });
    expect(emailInput).toHaveProperty("value", "hello@example.com");
    expect(emailInput.getAttribute("class")).toContain("bg-white/45");
    expect(emailInput.getAttribute("class")).toContain("dark:bg-zinc-900/50");
    expect(emailInput.getAttribute("class")).not.toContain("bg-background");

    fireEvent.click(screen.getByRole("tab", { name: "Email & Password" }));

    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Email & Password" }).getAttribute("data-state")).toBe("active");
  });
});
