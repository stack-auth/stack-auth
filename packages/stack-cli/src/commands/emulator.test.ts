import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  envPort,
  formatBytes,
  formatDuration,
  platformInstallHint,
  renderProgressLine,
  resolveArch,
} from "./emulator.js";

describe("formatBytes", () => {
  it("renders B / KB / MB / GB across unit boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
  });

  it("switches precision at v>=10 within a unit", () => {
    expect(formatBytes(1024 * 10)).toBe("10 KB");
    expect(formatBytes(1024 * 9.5)).toBe("9.5 KB");
  });

  it("returns '?' for non-finite and negative values", () => {
    expect(formatBytes(NaN)).toBe("?");
    expect(formatBytes(Infinity)).toBe("?");
    expect(formatBytes(-1)).toBe("?");
  });

  it("caps at TB for very large values", () => {
    // Even if we exceed TB, we don't walk off the end of the units array.
    const huge = 1024 ** 6; // exabyte-scale
    expect(formatBytes(huge)).toMatch(/ TB$/);
  });
});

describe("formatDuration", () => {
  it("uses s/m/h units at the right boundaries", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(60)).toBe("1m00s");
    expect(formatDuration(61)).toBe("1m01s");
    expect(formatDuration(3599)).toBe("59m59s");
    expect(formatDuration(3600)).toBe("1h00m");
    expect(formatDuration(3660)).toBe("1h01m");
  });

  it("rounds seconds to integers", () => {
    expect(formatDuration(59.4)).toBe("59s");
    expect(formatDuration(59.9)).toBe("1m00s");
  });

  it("returns '?' for non-finite and negative values", () => {
    expect(formatDuration(NaN)).toBe("?");
    expect(formatDuration(Infinity)).toBe("?");
    expect(formatDuration(-1)).toBe("?");
  });
});

describe("renderProgressLine", () => {
  it("renders a known-size progress bar with percent, size, speed, and ETA", () => {
    const line = renderProgressLine(1024, 2048, 512);
    expect(line).toContain("50.0%");
    expect(line).toContain("/");
    expect(line).toContain("/s");
    expect(line).toContain("eta");
  });

  it("hides the percent / ETA fields when total size is unknown (total=0)", () => {
    const line = renderProgressLine(1024, 0, 512);
    expect(line).not.toContain("%");
    expect(line).not.toContain("eta");
    expect(line).toContain("/s");
  });

  it("clamps percent at 100 if downloaded overshoots total (rounding)", () => {
    const line = renderProgressLine(2050, 2048, 100);
    expect(line).toContain("100.0%");
  });

  it("handles bytesPerSec = 0 by suppressing ETA", () => {
    const line = renderProgressLine(512, 2048, 0);
    expect(line).not.toContain("eta");
  });
});

describe("envPort", () => {
  const SAVED = process.env.__TEST_PORT;
  beforeEach(() => {
    delete process.env.__TEST_PORT;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.__TEST_PORT;
    else process.env.__TEST_PORT = SAVED;
  });

  it("returns the fallback when the env var is not set", () => {
    expect(envPort("__TEST_PORT", 1234)).toBe(1234);
  });

  it("parses a valid integer value", () => {
    process.env.__TEST_PORT = "9876";
    expect(envPort("__TEST_PORT", 1234)).toBe(9876);
  });

  it("rejects zero and negative values", () => {
    process.env.__TEST_PORT = "0";
    expect(() => envPort("__TEST_PORT", 1234)).toThrow(/Invalid __TEST_PORT/);
    process.env.__TEST_PORT = "-5";
    expect(() => envPort("__TEST_PORT", 1234)).toThrow(/Invalid __TEST_PORT/);
  });

  it("rejects non-integer and non-numeric values", () => {
    process.env.__TEST_PORT = "3.14";
    expect(() => envPort("__TEST_PORT", 1234)).toThrow(/Invalid __TEST_PORT/);
    process.env.__TEST_PORT = "not-a-port";
    expect(() => envPort("__TEST_PORT", 1234)).toThrow(/Invalid __TEST_PORT/);
  });

  it("treats empty string as not set (returns fallback)", () => {
    // Regression target: earlier versions sometimes parsed "" as 0 and threw.
    process.env.__TEST_PORT = "";
    expect(envPort("__TEST_PORT", 1234)).toBe(1234);
  });
});

describe("resolveArch", () => {
  it("accepts explicit arm64 / amd64", () => {
    expect(resolveArch("arm64")).toBe("arm64");
    expect(resolveArch("amd64")).toBe("amd64");
  });

  it("throws on unsupported explicit arch", () => {
    expect(() => resolveArch("mips")).toThrow(/Invalid architecture/);
    expect(() => resolveArch("x86")).toThrow(/Invalid architecture/);
  });

  it("maps the current process arch when raw is undefined", () => {
    const expected = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
    if (expected === null) {
      expect(() => resolveArch()).toThrow(/Invalid architecture/);
    } else {
      expect(resolveArch()).toBe(expected);
    }
  });
});

describe("platformInstallHint", () => {
  it("uses brew on darwin and apt on linux", () => {
    const spy = vi.spyOn(process, "platform", "get");
    try {
      spy.mockReturnValue("darwin");
      expect(platformInstallHint("foo-linux", "foo-mac")).toContain("brew install foo-mac");
      spy.mockReturnValue("linux");
      expect(platformInstallHint("foo-linux", "foo-mac")).toContain("apt install foo-linux");
      spy.mockReturnValue("win32");
      expect(platformInstallHint("foo-linux", "foo-mac")).toContain("install foo-mac");
    } finally {
      spy.mockRestore();
    }
  });
});
