import { describe, expect, it, vi } from "vitest";
import { createObservedPostgresClient } from "./postgres-client";

describe("createObservedPostgresClient", () => {
  it("observes asynchronous client errors instead of crashing the process", () => {
    const onError = vi.fn();
    const client = createObservedPostgresClient({}, "postgres-test-client", onError);
    const error = new Error("connection terminated");

    expect(client.emit("error", error)).toBe(true);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
