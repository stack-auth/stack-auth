import { describe, expect, it, vi } from "vitest";
import { pollForConfigPush } from "./link-existing-onboarding-polling";

describe("pollForConfigPush", () => {
  it("recovers from a transient source request failure", async () => {
    const transientError = new Error("temporary network failure");
    const getPushedConfigSource = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ type: "unlinked" })
      .mockResolvedValueOnce({ type: "github" });
    const onTransientError = vi.fn();
    const onPollSucceeded = vi.fn();
    const waitForNextAttempt = vi.fn(async (_milliseconds: number) => {});

    await expect(pollForConfigPush({
      shouldContinue: () => true,
      getPushedConfigSource,
      onTransientError,
      onPollSucceeded,
      waitForNextAttempt,
    })).resolves.toBe("linked");

    expect(getPushedConfigSource).toHaveBeenCalledTimes(3);
    expect(onTransientError).toHaveBeenCalledWith(transientError);
    expect(onPollSucceeded).toHaveBeenCalledTimes(2);
    expect(waitForNextAttempt).toHaveBeenNthCalledWith(1, 1_000);
    expect(waitForNextAttempt).toHaveBeenNthCalledWith(2, 1_000);
  });

  it("does not report a linked config after cancellation during a request", async () => {
    let shouldContinue = true;
    let resolveSource: ((source: { type: string }) => void) | undefined;
    const getPushedConfigSource = () => new Promise<{ type: string }>((resolve) => {
      resolveSource = resolve;
    });

    const polling = pollForConfigPush({
      shouldContinue: () => shouldContinue,
      getPushedConfigSource,
      onTransientError: vi.fn(),
      onPollSucceeded: vi.fn(),
      waitForNextAttempt: vi.fn(async (_milliseconds: number) => {}),
    });

    expect(resolveSource).toBeDefined();
    shouldContinue = false;
    resolveSource?.({ type: "github" });

    await expect(polling).resolves.toBe("cancelled");
  });

  it("backs off repeated failures and resets after a successful poll", async () => {
    const getPushedConfigSource = vi.fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce({ type: "unlinked" })
      .mockRejectedValueOnce(new Error("third failure"))
      .mockResolvedValueOnce({ type: "github" });
    const waitForNextAttempt = vi.fn(async (_milliseconds: number) => {});

    await expect(pollForConfigPush({
      shouldContinue: () => true,
      getPushedConfigSource,
      onTransientError: vi.fn(),
      onPollSucceeded: vi.fn(),
      waitForNextAttempt,
    })).resolves.toBe("linked");

    expect(waitForNextAttempt.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      1_000,
      2_000,
      1_000,
      1_000,
    ]);
  });
});
