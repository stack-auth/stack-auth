// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildErrorEventData,
  computeErrorFingerprint,
  DEFAULT_IGNORE_ERRORS,
  installClientErrorCapture,
  installServerErrorMonitor,
  normalizeCapturedError,
  normalizeErrorCaptureOptions,
  type ClientErrorCaptureDeps,
} from "./error-capture";

function installWithDeps(overrides?: Partial<ClientErrorCaptureDeps>) {
  const emitted: Record<string, unknown>[] = [];
  const capture = installClientErrorCapture({
    emit: (data) => emitted.push(data),
    ignoreErrors: normalizeErrorCaptureOptions(undefined).ignoreErrors,
    release: "1.2.3",
    environment: "test",
    sdkVersion: "0.0.0-test",
    getCurrentPageViewSpanId: () => null,
    ...overrides,
  });
  if (capture === null) throw new Error("capture should install in jsdom");
  return { emitted, capture };
}

function fireOnError(error: Error, opts?: { url?: string, line?: number, col?: number }) {
  const handler = window.onerror;
  if (typeof handler !== "function") throw new Error("onerror not installed");
  return handler.call(window, error.message, opts?.url ?? "https://app.example.com/bundle.js", opts?.line ?? 10, opts?.col ?? 5, error);
}

function fireOnUnhandledRejection(event: unknown) {
  const handler = window.onunhandledrejection;
  if (typeof handler !== "function") throw new Error("onunhandledrejection not installed");
  // The property slot is typed for real PromiseRejectionEvents; tests drive it
  // with structural stand-ins (jsdom cannot synthesize the real thing outside
  // an actual unhandled rejection), which is exactly the loose input the
  // extraction logic must handle.
  return handler.call(window, event as PromiseRejectionEvent);
}

describe("normalizeErrorCaptureOptions", () => {
  it("defaults to enabled with the default ignores, merging user substrings", () => {
    expect(normalizeErrorCaptureOptions(undefined)).toEqual({ enabled: true, ignoreErrors: [...DEFAULT_IGNORE_ERRORS] });
    const normalized = normalizeErrorCaptureOptions({ enabled: false, ignoreErrors: ["ChunkLoadError"] });
    expect(normalized.enabled).toBe(false);
    expect(normalized.ignoreErrors).toEqual([...DEFAULT_IGNORE_ERRORS, "ChunkLoadError"]);
  });
});

describe("normalizeCapturedError + buildErrorEventData", () => {
  it("keeps Error identity and bounds message/stack to 8KB", () => {
    const error = new Error(`boom ${"x".repeat(20_000)}`);
    const data = buildErrorEventData(error, {
      mechanismType: "captured",
      handled: true,
      release: "r1",
      environment: "prod",
      sdkVersion: "9.9.9",
    });
    expect(data.name).toBe("Error");
    expect((data.message as string).length).toBeLessThanOrEqual(8_192);
    expect((data.message as string).startsWith("boom ")).toBe(true);
    expect(data.mechanism_type).toBe("captured");
    expect(data.handled).toBe(true);
    expect(data.synthetic).toBeUndefined();
    expect(typeof data.fingerprint).toBe("string");
    expect(data.release).toBe("r1");
    expect(data.environment).toBe("prod");
    expect(data.sdk_version).toBe("9.9.9");
  });

  it("describes plain objects by their keys and synthesizes a capture-time stack", () => {
    const normalized = normalizeCapturedError({ b: 2, a: 1 });
    expect(normalized.message).toBe("Object captured as exception with keys: a, b");
    expect(normalized.synthetic).toBe(true);
    expect(typeof normalized.stack).toBe("string");
  });

  it("stringifies primitives as synthetic and stackless", () => {
    expect(normalizeCapturedError("oops")).toEqual({ name: "Error", message: "oops", stack: null, synthetic: true });
    expect(normalizeCapturedError(null).synthetic).toBe(true);
  });

  it("fingerprints on name + message + first stack frame only", () => {
    const stackA = "Error: x\n    at foo (a.js:1:1)\n    at bar (b.js:2:2)";
    const stackB = "Error: x\n    at foo (a.js:1:1)\n    at OTHER (c.js:9:9)";
    expect(computeErrorFingerprint("Error", "x", stackA)).toBe(computeErrorFingerprint("Error", "x", stackB));
    expect(computeErrorFingerprint("Error", "x", stackA)).not.toBe(computeErrorFingerprint("Error", "y", stackA));
  });
});

describe("installClientErrorCapture", () => {
  afterEach(() => {
    // Tests install/uninstall explicitly; make sure a failed test cannot leak
    // a patched slot into the next one.
    window.onerror = null;
    window.onunhandledrejection = null;
    vi.restoreAllMocks();
  });

  it("patches the property slots, chains the previous handler, and forwards its return value", () => {
    const previous = vi.fn((..._args: unknown[]) => true);
    window.onerror = previous;
    const { emitted, capture } = installWithDeps();

    const error = new Error("boom");
    const returned = fireOnError(error);

    expect(returned).toBe(true);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous.mock.calls[0][4]).toBe(error);
    expect(emitted).toHaveLength(1);

    capture.uninstall();
    expect(window.onerror).toBe(previous);
  });

  it("raises Error.stackTraceLimit at install and restores it on uninstall", () => {
    const errorCtor = Error as ErrorConstructor & { stackTraceLimit?: number };
    const before = errorCtor.stackTraceLimit;
    if (typeof before !== "number") return; // non-V8 runtime: nothing to assert
    const { capture } = installWithDeps();
    expect(errorCtor.stackTraceLimit).toBe(50);
    capture.uninstall();
    expect(errorCtor.stackTraceLimit).toBe(before);
  });

  it("captures onerror payloads with location fields, url/path, and release metadata", () => {
    window.history.replaceState(null, "", "/oauth/callback?code=secret-code#fragment");
    const { emitted, capture } = installWithDeps();
    fireOnError(new Error("boom"), { url: "https://app.example.com/x.js", line: 3, col: 7 });

    expect(emitted).toHaveLength(1);
    const data = emitted[0];
    expect(data.message).toBe("boom");
    expect(data.name).toBe("Error");
    expect(typeof data.stack).toBe("string");
    expect(data.mechanism_type).toBe("global.onerror");
    expect(data.handled).toBe(false);
    expect(data.filename).toBe("https://app.example.com/x.js");
    expect(data.lineno).toBe(3);
    expect(data.colno).toBe(7);
    expect(data.url).toBe(`${window.location.origin}/oauth/callback`);
    expect(data.url).not.toContain("secret-code");
    expect(data.path).toBe(window.location.pathname);
    expect(data.release).toBe("1.2.3");
    expect(data.environment).toBe("test");
    expect(data.sdk_version).toBe("0.0.0-test");
    capture.uninstall();
    window.history.replaceState(null, "", "/");
  });

  it("synthesizes a single url:line:col frame when onerror has no error object", () => {
    const { emitted, capture } = installWithDeps();
    const handler = window.onerror;
    if (typeof handler !== "function") throw new Error("onerror not installed");
    handler.call(window, "Uncaught Error: weird", "https://app.example.com/legacy.js", 42, 8, undefined);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].message).toBe("Uncaught Error: weird");
    expect(emitted[0].stack).toContain("at ? (https://app.example.com/legacy.js:42:8)");
    expect(emitted[0].synthetic).toBe(1);
    capture.uninstall();
  });

  it("extracts rejection reasons 3-way: .reason, .detail.reason, and primitive events", () => {
    const { emitted, capture } = installWithDeps();

    const reasonError = new Error("from reason");
    fireOnUnhandledRejection({ reason: reasonError });
    expect(emitted[0].message).toBe("from reason");
    expect(emitted[0].mechanism_type).toBe("global.unhandledrejection");

    const detailError = new Error("from detail");
    fireOnUnhandledRejection({ detail: { reason: detailError } });
    expect(emitted[1].message).toBe("from detail");

    fireOnUnhandledRejection(42);
    expect(emitted[2].message).toBe("Non-Error promise rejection captured with value: 42");
    expect(emitted[2].synthetic).toBe(1);
    capture.uninstall();
  });

  it("describes plain-object rejections by their keys", () => {
    const { emitted, capture } = installWithDeps();
    fireOnUnhandledRejection({ reason: { code: 500, details: "x" } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].message).toBe("Object captured as exception with keys: code, details");
    expect(emitted[0].synthetic).toBe(1);
    capture.uninstall();
  });

  it("drops messages matching the default ignores (cross-origin noise)", () => {
    const { emitted, capture } = installWithDeps();
    fireOnError(new Error("Script error."));
    fireOnError(new Error("ResizeObserver loop completed with undelivered notifications."));
    expect(emitted).toHaveLength(0);
    capture.uninstall();
  });

  it("never captures the same error OBJECT twice (marker), even across both hooks", () => {
    const { emitted, capture } = installWithDeps();
    const error = new Error("boom once");
    fireOnError(error);
    fireOnUnhandledRejection({ reason: error });
    expect(emitted).toHaveLength(1);
    capture.uninstall();
  });

  it("drops an identical back-to-back signature (single-slot dedupe) but keeps alternating errors", () => {
    const { emitted, capture } = installWithDeps();
    // Two distinct objects with identical name/message/stack → second drops.
    const a1 = new Error("same");
    const a2 = new Error("same");
    a2.stack = a1.stack;
    fireOnError(a1);
    fireOnError(a2);
    expect(emitted).toHaveLength(1);
    // A different error in between clears the slot.
    fireOnError(new Error("other"));
    const a3 = new Error("same");
    a3.stack = a1.stack;
    fireOnError(a3);
    expect(emitted).toHaveLength(3);
    capture.uninstall();
  });

  it("caps captures per fingerprint per page view and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pageViewSpanId: string | null = "11111111-1111-4111-8111-111111111111";
    const { emitted, capture } = installWithDeps({ getCurrentPageViewSpanId: () => pageViewSpanId });

    const stack = "Error: looped\n    at loop (a.js:1:1)";
    const otherStack = "Error: breaker\n    at other (b.js:2:2)";
    for (let i = 0; i < 15; i++) {
      const error = new Error("looped");
      error.stack = stack;
      fireOnError(error);
      // Alternate a distinct error so the single-slot dedupe never triggers —
      // this test is about the per-fingerprint cap alone.
      const breaker = new Error("breaker");
      breaker.stack = otherStack;
      fireOnError(breaker);
    }
    const loopedCount = emitted.filter((data) => data.message === "looped").length;
    const breakerCount = emitted.filter((data) => data.message === "breaker").length;
    expect(loopedCount).toBe(10);
    expect(breakerCount).toBe(10);
    expect(warnSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("rate cap")).length).toBe(1);

    // Navigation (page-view span rollover) resets the budget.
    pageViewSpanId = "22222222-2222-4222-8222-222222222222";
    const fresh = new Error("looped");
    fresh.stack = stack;
    fireOnError(fresh);
    expect(emitted.filter((data) => data.message === "looped").length).toBe(11);
    capture.uninstall();
  });

  it("caps total captures per page view", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { emitted, capture } = installWithDeps();
    for (let i = 0; i < 120; i++) {
      // Unique message per error → unique fingerprint, so only the total cap
      // can stop the flood.
      fireOnError(new Error(`unique ${i}`));
    }
    expect(emitted).toHaveLength(100);
    expect(warnSpy).toHaveBeenCalled();
    capture.uninstall();
  });

  it("warns once and never recurses when the emit sink itself throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = installClientErrorCapture({
      emit: () => {
        throw new Error("sink exploded");
      },
      ignoreErrors: [],
      release: null,
      environment: null,
      sdkVersion: "0.0.0-test",
      getCurrentPageViewSpanId: () => null,
    });
    if (capture === null) throw new Error("capture should install in jsdom");
    fireOnError(new Error("boom 1"));
    fireOnError(new Error("boom 2"));
    expect(warnSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("error capture failed")).length).toBe(1);
    capture.uninstall();
  });
});

describe("installServerErrorMonitor", () => {
  it("registers an uncaughtExceptionMonitor listener with replace semantics per project", () => {
    const baseline = process.listenerCount("uncaughtExceptionMonitor");
    const captured: unknown[] = [];
    const uninstall1 = installServerErrorMonitor({ projectId: "p1", capture: (error) => captured.push(error) });
    expect(uninstall1).not.toBeNull();
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(baseline + 1);

    // Reinstall for the same project (HMR): the old listener is replaced, not
    // stacked.
    const uninstall2 = installServerErrorMonitor({ projectId: "p1", capture: (error) => captured.push(error) });
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(baseline + 1);

    const error = new Error("server crash");
    process.emit("uncaughtExceptionMonitor", error);
    expect(captured).toEqual([error]);

    uninstall2?.();
    // Uninstalling the superseded handle is a no-op (already replaced).
    uninstall1?.();
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(baseline);
  });

  it("warns instead of throwing when capture fails mid-crash", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const uninstall = installServerErrorMonitor({
      projectId: "p2",
      capture: () => {
        throw new Error("reporting failed");
      },
    });
    expect(() => process.emit("uncaughtExceptionMonitor", new Error("crash"))).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    uninstall?.();
    warnSpy.mockRestore();
  });
});
