import { afterEach, describe, expect, it } from "vitest";
import type { SpanRef } from "./event-tracker";
import { getAmbientSpanRefs, runWithSpanContext, runWithSpanFrame } from "./span-context";
import { __setAsyncContextModeForTesting } from "./span-context.test-utils";

function ref(spanId: string, parentSpanIds: string[] = []): SpanRef {
  return { spanId, parentSpanIds };
}

function ambientIds(): string[] {
  return getAmbientSpanRefs().map((frame) => frame.spanId);
}

describe("span context (AsyncLocalStorage)", () => {
  afterEach(() => {
    __setAsyncContextModeForTesting("auto");
  });

  it("propagates nested frames across await boundaries, outermost first", async () => {
    expect(getAmbientSpanRefs()).toEqual([]);
    await runWithSpanContext(ref("a"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(ambientIds()).toEqual(["a"]);
      await runWithSpanContext(ref("b"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(ambientIds()).toEqual(["a", "b"]);
      });
      // Inner frame is gone once its withSpan settles.
      expect(ambientIds()).toEqual(["a"]);
    });
    expect(getAmbientSpanRefs()).toEqual([]);
  });

  it("isolates interleaved parallel flows — no cross-parenting under ALS", async () => {
    const seen: Record<string, string[]> = {};
    await Promise.all([
      runWithSpanContext(ref("flow1"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.flow1 = ambientIds();
      }),
      runWithSpanContext(ref("flow2"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.flow2 = ambientIds();
      }),
    ]);
    expect(seen.flow1).toEqual(["flow1"]);
    expect(seen.flow2).toEqual(["flow2"]);
  });

  it("frames carry their full SpanRef (chain included), not just the id", async () => {
    await runWithSpanContext(ref("child", ["root-ancestor"]), async () => {
      expect(getAmbientSpanRefs()).toEqual([{ spanId: "child", parentSpanIds: ["root-ancestor"] }]);
    });
  });
});

describe("span context (sync-stack fallback)", () => {
  afterEach(() => {
    __setAsyncContextModeForTesting("auto");
  });

  it("is correct for sequential nested flows and removes its own frame on settle", async () => {
    __setAsyncContextModeForTesting("sync-stack");
    await runWithSpanContext(ref("a"), async () => {
      expect(ambientIds()).toEqual(["a"]);
      await runWithSpanContext(ref("b"), async () => {
        expect(ambientIds()).toEqual(["a", "b"]);
      });
      expect(ambientIds()).toEqual(["a"]);
    });
    expect(getAmbientSpanRefs()).toEqual([]);
  });

  it("removes its own frame even when it is no longer on top (interleaving-safe cleanup)", async () => {
    __setAsyncContextModeForTesting("sync-stack");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    // Start flow1 but leave it parked on an await, then run flow2 to completion
    // while flow1's frame is still on the stack. flow2 must remove ITS frame
    // (not flow1's) even though flow1's frame sits beneath it.
    const first = runWithSpanContext(ref("flow1"), async () => {
      await firstBlocked;
      // Documented sync-stack limitation: no isolation guarantee here; the
      // cleanup contract is what this test pins down.
    });
    await runWithSpanContext(ref("flow2"), async () => {
      expect(ambientIds()).toEqual(["flow1", "flow2"]);
    });
    expect(ambientIds()).toEqual(["flow1"]);
    releaseFirst();
    await first;
    expect(getAmbientSpanRefs()).toEqual([]);
  });
});

describe("span context (exact sync-window reads)", () => {
  afterEach(() => {
    __setAsyncContextModeForTesting("auto");
  });

  function exactIds(): string[] {
    return getAmbientSpanRefs({ includeSuspendedSyncFrames: false }).map((frame) => frame.spanId);
  }

  it("sees prologue-open frames only; suspended frames are best-effort only", async () => {
    __setAsyncContextModeForTesting("sync-stack");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runWithSpanContext(ref("flow1"), async () => {
      await firstBlocked;
    });
    // flow1 is suspended at its await: no longer provably the current flow.
    expect(exactIds()).toEqual([]);
    expect(ambientIds()).toEqual(["flow1"]);
    await runWithSpanContext(ref("flow2"), async () => {
      // flow2's synchronous prologue: exact reads see ONLY flow2 — this is the
      // property that makes cross-flow misattribution impossible in exact mode.
      expect(exactIds()).toEqual(["flow2"]);
      expect(ambientIds()).toEqual(["flow1", "flow2"]);
    });
    releaseFirst();
    await first;
    expect(getAmbientSpanRefs()).toEqual([]);
  });

  it("keeps outer frames exact through SYNCHRONOUS nesting, and drops them after an await", async () => {
    __setAsyncContextModeForTesting("sync-stack");
    await runWithSpanContext(ref("a"), async () => {
      expect(exactIds()).toEqual(["a"]);
      await runWithSpanContext(ref("b"), async () => {
        // b's prologue executes while a's callback is still mid-statement, so
        // both frames are provably the current flow.
        expect(exactIds()).toEqual(["a", "b"]);
      });
      // Back after an await: a's prologue is over — exact reads fail closed,
      // best-effort reads still see the suspended frame.
      expect(exactIds()).toEqual([]);
      expect(ambientIds()).toEqual(["a"]);
    });
  });

  it("runWithSpanFrame re-binds a frame exactly for a synchronous window", () => {
    __setAsyncContextModeForTesting("sync-stack");
    const result = runWithSpanFrame(ref("manual"), () => {
      expect(exactIds()).toEqual(["manual"]);
      return 42;
    });
    expect(result).toBe(42);
    expect(getAmbientSpanRefs()).toEqual([]);
  });

  it("runWithSpanFrame keeps a suspended frame for best-effort readers until settle", async () => {
    __setAsyncContextModeForTesting("sync-stack");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const promise = runWithSpanFrame(ref("callback"), async () => {
      expect(exactIds()).toEqual(["callback"]);
      await blocked;
    });
    expect(exactIds()).toEqual([]);
    expect(ambientIds()).toEqual(["callback"]);
    release();
    await promise;
    // One extra microtask for the .finally(pop) chained on the result.
    await Promise.resolve();
    expect(getAmbientSpanRefs()).toEqual([]);
  });
});
