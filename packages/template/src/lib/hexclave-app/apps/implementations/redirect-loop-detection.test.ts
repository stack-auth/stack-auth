// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureErrorMock = vi.fn();
vi.mock("@hexclave/shared/dist/utils/errors", () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...args),
  HexclaveAssertionError: class HexclaveAssertionError extends Error {
    constructor(message: string, public readonly details?: Record<string, unknown>) {
      super(message);
    }
  },
}));

import { detectRedirectLoop } from "./redirect-loop-detection";

const STORAGE_KEY = "hexclave-redirect-breadcrumbs";

describe("detectRedirectLoop", () => {
  beforeEach(() => {
    sessionStorage.clear();
    captureErrorMock.mockClear();
    Object.defineProperty(window, "location", {
      value: { pathname: "/a", href: "http://localhost/a", origin: "http://localhost" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fire captureError on the first redirect", () => {
    detectRedirectLoop({ targetUrl: "/b", projectId: "test-project" });
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("does not fire captureError when redirecting to different pages", () => {
    detectRedirectLoop({ targetUrl: "/b", projectId: "test-project" });

    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "/c", projectId: "test-project" });

    window.location.pathname = "/c";
    window.location.href = "http://localhost/c";
    detectRedirectLoop({ targetUrl: "/d", projectId: "test-project" });

    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("fires captureError when an A->B->A loop is detected", () => {
    // First redirect: on /a, redirecting to /b — records pair (/a → /b)
    detectRedirectLoop({ targetUrl: "/b", projectId: "test-project" });

    // Second redirect: on /b, redirecting to /a — records pair (/b → /a)
    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "/a", projectId: "test-project" });

    // Third redirect: on /a, redirecting to /b — pair (/a → /b) already seen, loop detected
    window.location.pathname = "/a";
    window.location.href = "http://localhost/a";
    detectRedirectLoop({ targetUrl: "/b", projectId: "test-project" });

    expect(captureErrorMock).toHaveBeenCalledOnce();
    expect(captureErrorMock).toHaveBeenCalledWith(
      "redirect-loop-detected",
      expect.objectContaining({
        message: expect.stringContaining("Redirect loop detected"),
      }),
    );
  });

  it("clears breadcrumbs after firing so it does not spam on subsequent redirects", () => {
    // Build up to a loop
    detectRedirectLoop({ targetUrl: "/b", projectId: "p" });

    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "/a", projectId: "p" });

    window.location.pathname = "/a";
    window.location.href = "http://localhost/a";
    detectRedirectLoop({ targetUrl: "/b", projectId: "p" });

    expect(captureErrorMock).toHaveBeenCalledOnce();

    // Subsequent redirect after loop detection should NOT fire again (breadcrumbs cleared)
    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "/a", projectId: "p" });

    expect(captureErrorMock).toHaveBeenCalledOnce();
  });

  it("ignores old breadcrumbs outside the 30s window", () => {
    // Simulate old breadcrumbs from > 30s ago
    const oldTimestamp = performance.now() - 31_000;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([
      { from: "/a", to: "/b", timestamp: oldTimestamp },
      { from: "/b", to: "/a", timestamp: oldTimestamp + 100 },
    ]));

    // New redirect /a → /b — the old pair (/a → /b) is outside the window, so no loop
    detectRedirectLoop({ targetUrl: "/b", projectId: "p" });
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("handles full absolute URLs as target", () => {
    detectRedirectLoop({ targetUrl: "http://localhost/b", projectId: "p" });

    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "http://localhost/a", projectId: "p" });

    window.location.pathname = "/a";
    window.location.href = "http://localhost/a";
    detectRedirectLoop({ targetUrl: "http://localhost/b", projectId: "p" });

    expect(captureErrorMock).toHaveBeenCalledOnce();
  });

  it("silently ignores sessionStorage errors", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: access denied");
    });

    expect(() => {
      detectRedirectLoop({ targetUrl: "/b", projectId: "p" });
    }).not.toThrow();
    expect(captureErrorMock).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
  });

  it("includes projectId and URLs in the error details", () => {
    detectRedirectLoop({ targetUrl: "/b", projectId: "my-project-123" });

    window.location.pathname = "/b";
    window.location.href = "http://localhost/b";
    detectRedirectLoop({ targetUrl: "/a", projectId: "my-project-123" });

    window.location.pathname = "/a";
    window.location.href = "http://localhost/a";
    detectRedirectLoop({ targetUrl: "/b", projectId: "my-project-123" });

    const error = captureErrorMock.mock.calls[0][1];
    expect(error.details).toEqual(expect.objectContaining({
      projectId: "my-project-123",
      targetUrl: "/b",
      currentUrl: "http://localhost/a",
    }));
  });
});
