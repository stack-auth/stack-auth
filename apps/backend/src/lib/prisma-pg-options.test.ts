import { describe, expect, it, vi } from "vitest";
import { createPrismaPgOptions } from "./prisma-pg-options";

describe("createPrismaPgOptions", () => {
  it("owns the external pool and observes pool and checked-out connection errors", () => {
    const onError = vi.fn();
    const options = createPrismaPgOptions("tenant_schema", "primary", onError);
    const poolError = new Error("idle connection failed");
    const connectionError = new Error("checked-out connection failed");

    options.onPoolError?.(poolError);
    options.onConnectionError?.(connectionError);

    expect(options.disposeExternalPool).toBe(true);
    expect(options.schema).toBe("tenant_schema");
    expect(onError.mock.calls).toEqual([
      ["pg-pool-primary", poolError],
      ["pg-connection-primary", connectionError],
    ]);
  });
});
