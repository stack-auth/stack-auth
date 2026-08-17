// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mockSignInWithCredential = vi.hoisted(() => vi.fn());
const mockSignUpWithCredential = vi.hoisted(() => vi.fn());
const mockCaptureError = vi.hoisted(() => vi.fn());
const mockCurrentUser = vi.hoisted<{ current: { id: string } | null }>(() => ({ current: null }));

vi.mock("@/app/loading", () => ({
  default: () => <div>Loading preview</div>,
}));

vi.mock("@/components/config-update", () => ({
  ConfigUpdateDialogProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/hexclave-rebrand-modal", () => ({
  HexclaveRebrandModal: () => null,
}));

vi.mock("@hexclave/dashboard-ui-components", () => ({
  CursorBlastEffect: () => null,
}));

vi.mock("@/components/design-components/alert", () => ({
  DesignAlert: ({ title, description }: { title: string, description: string }) => (
    <div role="alert">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: (name: string) => name === "NEXT_PUBLIC_STACK_IS_PREVIEW" ? "true" : "false",
}));

vi.mock("@hexclave/next", () => ({
  useStackApp: () => ({
    signInWithCredential: mockSignInWithCredential,
    signUpWithCredential: mockSignUpWithCredential,
  }),
  useUser: () => mockCurrentUser.current,
}));

vi.mock("@hexclave/shared/dist/utils/errors", () => ({
  captureError: mockCaptureError,
}));

vi.mock("@hexclave/shared/dist/utils/promises", () => ({
  runAsynchronously: (
    promise: Promise<unknown>,
    options: { onError?: (error: Error) => void },
  ) => promise.then(undefined, options.onError),
}));

vi.mock("@hexclave/shared/dist/utils/uuids", () => ({
  generateUuid: () => "preview-id",
}));

import LayoutClient from "./layout-client";

afterEach(() => {
  cleanup();
  mockSignInWithCredential.mockReset();
  mockSignUpWithCredential.mockReset();
  mockCaptureError.mockClear();
  mockCurrentUser.current = null;
  window.alert = vi.fn();
});

describe("LayoutClient preview auto-login", () => {
  it("falls through an expected sign-in error and shows an inline error when sign-up throws", async () => {
    const alert = vi.spyOn(window, "alert");
    mockSignInWithCredential.mockResolvedValue({ status: "error", error: new Error("not found") });
    mockSignUpWithCredential.mockRejectedValue(new Error("sign-up failed"));

    render(
      <LayoutClient>
        <div>Dashboard</div>
      </LayoutClient>,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Preview unavailable"));
    expect(mockSignUpWithCredential).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith("preview-auto-login", expect.any(Error));
  });

  it("renders an inline error when sign-up returns an error result", async () => {
    const alert = vi.spyOn(window, "alert");
    mockSignInWithCredential.mockResolvedValue({ status: "error", error: new Error("not found") });
    mockSignUpWithCredential.mockResolvedValue({ status: "error", error: new Error("sign-up failed") });

    render(
      <LayoutClient>
        <div>Dashboard</div>
      </LayoutClient>,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Preview unavailable"));
    expect(screen.queryByText("Loading preview")).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith("preview-auto-login", expect.any(Error));
  });

  it("renders children when sign-in succeeds", async () => {
    mockSignInWithCredential.mockResolvedValue({ status: "ok" });

    const view = render(
      <LayoutClient>
        <div>Dashboard</div>
      </LayoutClient>,
    );

    await waitFor(() => expect(mockSignInWithCredential).toHaveBeenCalledTimes(1));
    mockCurrentUser.current = { id: "user-id" };
    view.rerender(
      <LayoutClient>
        <div>Dashboard</div>
      </LayoutClient>,
    );

    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mockSignUpWithCredential).not.toHaveBeenCalled();
  });
});
