import { afterEach, describe, expect, it, vi } from "vitest";
import { autoDetectedBackgroundTaskHook } from "./telemetry-core";

const VERCEL_REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

describe("autoDetectedBackgroundTaskHook (Vercel waitUntil auto-wiring)", () => {
  afterEach(() => {
    // Symbol keys are not covered by vi.unstubAllGlobals(), so clean up by hand.
    delete (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL];
    vi.restoreAllMocks();
  });

  it("hands the promise to the active Vercel request context's waitUntil", () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {
      get: () => ({ waitUntil }),
    };
    const promise = Promise.resolve();
    autoDetectedBackgroundTaskHook(promise);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(promise);
  });

  it("looks the context up PER CALL (request-scoped, never cached)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const holder = { get: () => ({ waitUntil: first }) };
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = holder;
    autoDetectedBackgroundTaskHook(Promise.resolve());
    holder.get = () => ({ waitUntil: second });
    autoDetectedBackgroundTaskHook(Promise.resolve());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is a no-op off Vercel and degrades to a no-op on any shape mismatch", () => {
    // No symbol at all.
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Holder without get.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {};
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Throwing get.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {
      get: () => {
        throw new Error("no active request");
      },
    };
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Context without waitUntil.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = { get: () => ({}) };
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
  });
});
