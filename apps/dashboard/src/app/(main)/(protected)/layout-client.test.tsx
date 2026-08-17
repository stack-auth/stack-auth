// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mockSignInWithCredential = vi.hoisted(() => vi.fn());
const mockSignUpWithCredential = vi.hoisted(() => vi.fn());
const mockCaptureError = vi.hoisted(() => vi.fn());

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

vi.mock("@/components/preview-flow-error", () => ({
  PreviewFlowError: () => <div role="alert">Preview unavailable</div>,
}));

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: (name: string) => name === "NEXT_PUBLIC_STACK_IS_PREVIEW" ? "true" : "false",
}));

vi.mock("@hexclave/next", () => ({
  useStackApp: () => ({
    signInWithCredential: mockSignInWithCredential,
    signUpWithCredential: mockSignUpWithCredential,
  }),
  useUser: () => null,
}));

vi.mock("@hexclave/shared/dist/utils/errors", () => ({
  captureError: mockCaptureError,
}));

vi.mock("@hexclave/shared/dist/utils/promises", () => ({
  runAsynchronously: (promise: Promise<unknown>) => {
    promise.catch(() => {});
  },
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
  window.alert = vi.fn();
});

describe("LayoutClient preview auto-login", () => {
  it("renders an inline error without alerting when auto-login fails", async () => {
    const alert = vi.spyOn(window, "alert");
    mockSignInWithCredential.mockRejectedValue(new Error("sign-in failed"));

    render(
      <LayoutClient>
        <div>Dashboard</div>
      </LayoutClient>,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Preview unavailable"));
    expect(alert).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith("preview-auto-login", expect.any(Error));
  });
});
