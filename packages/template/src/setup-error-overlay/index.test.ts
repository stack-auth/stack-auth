// @vitest-environment jsdom

import { HexclaveSetupError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showSetupErrorOverlay } from ".";

function createSetupError() {
  return new HexclaveSetupError({
    title: "A domain in your authentication flow is not one of your project's trusted domains",
    message: "Nested cross-domain auth callback URL https://demo.example.test/ is not trusted.",
    howToFix: ["Add https://demo.example.test to your project's trusted domains."],
  });
}

function overlayRoots() {
  return document.querySelectorAll(".hexclave-setup-error-overlay");
}

describe("setup error overlay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of overlayRoots()) {
      root.remove();
    }
    Reflect.deleteProperty(window, "__hexclave-setup-error-overlay");
  });

  it("renders setup errors with their fix instructions, even outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = createSetupError();

    const cleanup = showSetupErrorOverlay(error);
    try {
      expect(overlayRoots()).toHaveLength(1);
      const text = document.body.textContent;
      expect(text).toContain(error.title);
      expect(text).toContain(error.message);
      expect(text).toContain(error.howToFix[0]);
      expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
    } finally {
      cleanup();
    }

    expect(overlayRoots()).toHaveLength(0);
  });

  it("minimizes into a pill and back", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cleanup = showSetupErrorOverlay(createSetupError());
    try {
      const minimizeButton = document.querySelector<HTMLButtonElement>("[aria-label='Minimize Hexclave setup error']");
      expect(minimizeButton).not.toBeNull();
      minimizeButton?.click();
      expect(document.querySelector("[role='alertdialog']")).toBeNull();

      const pill = document.querySelector<HTMLButtonElement>("[aria-label='Show Hexclave setup error']");
      expect(pill).not.toBeNull();
      pill?.click();
      expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("keeps the first card instead of stacking later errors on top of it", () => {
    vi.stubEnv("NODE_ENV", "production");
    const firstError = createSetupError();
    const cleanup = showSetupErrorOverlay(firstError);
    try {
      const secondCleanup = showSetupErrorOverlay(new HexclaveSetupError({
        title: "Another setup error",
        message: "Another setup error happened.",
        howToFix: ["Fix the other thing."],
      }));
      secondCleanup();

      expect(overlayRoots()).toHaveLength(1);
      expect(document.body.textContent).toContain(firstError.message);
      expect(document.body.textContent).not.toContain("Another setup error happened.");
    } finally {
      cleanup();
    }
  });

  it("only shows errors that are not setup errors while developing", () => {
    vi.stubEnv("NODE_ENV", "production");
    showSetupErrorOverlay(new Error("Some internal failure."))();
    expect(overlayRoots()).toHaveLength(0);

    vi.stubEnv("NODE_ENV", "development");
    const cleanup = showSetupErrorOverlay(new Error("Some internal failure."));
    try {
      expect(overlayRoots()).toHaveLength(1);
      expect(document.body.textContent).toContain("Some internal failure.");
    } finally {
      cleanup();
    }
  });
});
