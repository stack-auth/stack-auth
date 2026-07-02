// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHostedBackUrl } from "./hosted-back-url";

describe("useHostedBackUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "",
    });
  });

  it("prefers an explicit back URL when provided", () => {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://example.com/pricing",
    });

    const { result } = renderHook(() => useHostedBackUrl("https://app.example.com/billing"));

    expect(result.current).toBe("https://app.example.com/billing");
  });

  it("uses an external referrer when no explicit back URL is provided", () => {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://example.com/pricing",
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://checkout.example.com",
      },
    });

    const { result } = renderHook(() => useHostedBackUrl(null));

    expect(result.current).toBe("https://example.com/pricing");
  });

  it("falls back to the hosted app root when there is no explicit or external back URL", () => {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://checkout.example.com/purchase/abc",
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://checkout.example.com",
      },
    });

    const { result } = renderHook(() => useHostedBackUrl(undefined));

    expect(result.current).toBe("/");
  });
});
