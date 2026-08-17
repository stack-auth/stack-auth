// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockSendRequest = vi.hoisted(() => vi.fn());
const mockRefreshOwnedProjects = vi.hoisted(() => vi.fn(async () => undefined));
const mockPush = vi.hoisted(() => vi.fn());
const mockCaptureError = vi.hoisted(() => vi.fn());
const mockInternalsSymbol = vi.hoisted(() => Symbol("hexclave-app-internals"));
const mockUser = vi.hoisted(() => ({ id: "user-id" }));

vi.mock("@/app/loading", () => ({
  default: () => <div>Loading preview</div>,
}));

vi.mock("@/components/preview-flow-error", () => ({
  PreviewFlowError: ({ onRetry }: { onRetry: () => void | Promise<void> }) => (
    <div>
      <p>Preview unavailable</p>
      <button type="button" onClick={() => void onRetry()}>Try again</button>
    </div>
  ),
}));

vi.mock("@/components/router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  hexclaveAppInternalsSymbol: mockInternalsSymbol,
}));

vi.mock("@hexclave/next", () => ({
  useStackApp: () => ({
    [mockInternalsSymbol]: {
      sendRequest: mockSendRequest,
      refreshOwnedProjects: mockRefreshOwnedProjects,
    },
  }),
  useUser: () => mockUser,
}));

vi.mock("@hexclave/shared/dist/utils/errors", () => ({
  captureError: mockCaptureError,
}));

vi.mock("@hexclave/shared/dist/utils/promises", () => ({
  runAsynchronously: (promise: Promise<unknown>) => {
    promise.catch(() => {});
  },
  wait: vi.fn(async () => undefined),
}));

import PreviewProjectRedirect from "./preview-project-redirect";

afterEach(() => {
  cleanup();
  mockSendRequest.mockReset();
  mockRefreshOwnedProjects.mockClear();
  mockPush.mockClear();
  mockCaptureError.mockClear();
  window.alert = vi.fn();
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PreviewProjectRedirect", () => {
  it("renders an inline error without alerting when project creation fails", async () => {
    const alert = vi.spyOn(window, "alert");
    mockSendRequest.mockRejectedValue(new Error("server failure"));

    render(<PreviewProjectRedirect />);

    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeTruthy());
    expect(alert).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith("preview-project-create", expect.any(Error));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("retries project creation and navigates after a successful response", async () => {
    mockSendRequest
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response(200, { project_id: "project-id" }));

    render(<PreviewProjectRedirect />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/projects/project-id"));
    expect(mockSendRequest).toHaveBeenCalledTimes(4);
    expect(mockRefreshOwnedProjects).toHaveBeenCalledTimes(1);
  });
});
