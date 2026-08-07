import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReconciliationLease } from "./types.js";

let stored: { value: ReconciliationLease, etag: string } | null = null;
let nextEtag = 1;

vi.mock("./store.js", () => ({
  readReconciliationLease: vi.fn(async () => stored),
  createReconciliationLease: vi.fn(async (_ns: string, _key: string, lease: ReconciliationLease) => {
    if (stored !== null) return null;
    const etag = String(nextEtag++);
    stored = { value: lease, etag };
    return etag;
  }),
  replaceReconciliationLease: vi.fn(async (_ns: string, _key: string, lease: ReconciliationLease, previousEtag: string) => {
    if (stored?.etag !== previousEtag) return null;
    const etag = String(nextEtag++);
    stored = { value: lease, etag };
    return etag;
  }),
  releaseReconciliationLease: vi.fn(async (_ns: string, _key: string, etag: string) => {
    if (stored?.etag !== etag) return false;
    stored = null;
    return true;
  }),
}));

import { withReconciliationLease } from "./reconciliation-lock.js";

describe("service reconciliation lease", () => {
  beforeEach(() => {
    stored = null;
    nextEtag = 1;
  });

  it("serializes concurrent work for the same service", async () => {
    let releaseFirst: () => void = () => {
      throw new Error("first reconciliation release was not initialized");
    };
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const timings = { durationMs: 1000, renewIntervalMs: 500, contendedPollMs: 5 };

    const first = withReconciliationLease("ns", "web", async () => {
      events.push("first-start");
      await firstMayFinish;
      events.push("first-end");
    }, timings);
    await vi.waitFor(() => expect(events).toEqual(["first-start"]));

    const second = withReconciliationLease("ns", "web", async () => {
      events.push("second-start");
      events.push("second-end");
    }, timings);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });
});
