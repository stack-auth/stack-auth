import { describe, expect, it, vi } from "vitest";
import { waitForBackend } from "./run-cron-jobs";

describe("waitForBackend", () => {
  it("waits through connection failures and unhealthy responses", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const waitImpl = vi.fn().mockResolvedValue(undefined);

    await waitForBackend({
      baseUrl: "http://localhost:9302",
      fetchImpl,
      waitImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "http://localhost:9302");
    expect(waitImpl).toHaveBeenCalledTimes(2);
    expect(waitImpl).toHaveBeenCalledWith(1000);
  });

  it("returns immediately when the backend is already ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const waitImpl = vi.fn().mockResolvedValue(undefined);

    await waitForBackend({
      baseUrl: "http://localhost:9302",
      fetchImpl,
      waitImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(waitImpl).not.toHaveBeenCalled();
  });
});
