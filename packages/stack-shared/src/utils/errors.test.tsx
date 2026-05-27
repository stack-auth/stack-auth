import { afterEach, describe, expect, it, vi } from "vitest";
import { captureError, captureWarning, HexclaveAssertionError, registerErrorSink } from "./errors";

describe("error capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures warnings in the same sinks as errors and logs them as warnings", () => {
    const sink = vi.fn();
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("warning");

    registerErrorSink(sink);
    captureWarning("warning-location", error);

    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining("Captured warning in warning-location:"),
      expect.stringContaining("warning"),
      "\x1b[0m",
    );
    expect(sink).toHaveBeenCalledWith("warning-location", error);
  });

  it("keeps captureError logging as an error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    captureError("error-location", new Error("error"));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Captured error in error-location:"),
      expect.stringContaining("error"),
      "\x1b[0m",
    );
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it("keeps custom capture extra args when capturing warnings", () => {
    const sink = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const extraData = { projectId: "internal" };
    const error = new HexclaveAssertionError("warning", extraData);

    registerErrorSink(sink);
    captureWarning("warning-location", error);

    expect(sink).toHaveBeenCalledWith("warning-location", error, extraData);
  });
});
