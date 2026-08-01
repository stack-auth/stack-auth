import { generateW3cSpanId, generateW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { afterEach, describe, expect, it } from "vitest";
import { getAmbientSpanContexts, runWithSpanContext, runWithSpanFrame } from "./span-context";
import { syncStack } from "./span-context-state";
import { setAsyncContextModeForTesting } from "./span-context-state";
import type { SpanContext } from "./telemetry-core";

// Frames are plain W3C SpanContexts, which are unreadable in assertions, so
// every context minted here is tagged with a human label. The ids themselves
// stay real 32/16-hex values: these frames feed resolveSpanParent in production,
// which rejects malformed ids, so a test using fake ids could pass against a
// context shape the resolver would refuse.
const labelsBySpanId = new Map<string, string>();

function ctx(label: string, traceId: string = generateW3cTraceId()): SpanContext {
  const context: SpanContext = { traceId, spanId: generateW3cSpanId() };
  labelsBySpanId.set(context.spanId, label);
  return context;
}

function ambientLabels(): string[] {
  return getAmbientSpanContexts().map((context) => labelsBySpanId.get(context.spanId) ?? context.spanId);
}

describe("span context (AsyncLocalStorage)", () => {
  afterEach(() => {
    setAsyncContextModeForTesting("auto");
  });

  it("propagates nested frames across await boundaries, outermost first", async () => {
    expect(getAmbientSpanContexts()).toEqual([]);
    await runWithSpanContext(ctx("a"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(ambientLabels()).toEqual(["a"]);
      await runWithSpanContext(ctx("b"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(ambientLabels()).toEqual(["a", "b"]);
      });
      // Inner frame is gone once its withSpan settles.
      expect(ambientLabels()).toEqual(["a"]);
    });
    expect(getAmbientSpanContexts()).toEqual([]);
  });

  it("isolates interleaved parallel flows — no cross-parenting under ALS", async () => {
    const seen: Record<string, string[]> = {};
    await Promise.all([
      runWithSpanContext(ctx("flow1"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.flow1 = ambientLabels();
      }),
      runWithSpanContext(ctx("flow2"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.flow2 = ambientLabels();
      }),
    ]);
    expect(seen.flow1).toEqual(["flow1"]);
    expect(seen.flow2).toEqual(["flow2"]);
  });

  it("frames carry the whole SpanContext, trace id included — not just the span id", async () => {
    // Load-bearing: the resolver reads BOTH fields off an ambient frame (the
    // trace id decides whether a sibling ambient context is an ancestor or a
    // link), so a frame that dropped its trace id would silently fracture traces.
    const frame = ctx("child");
    await runWithSpanContext(frame, async () => {
      expect(getAmbientSpanContexts()).toEqual([{ traceId: frame.traceId, spanId: frame.spanId }]);
    });
  });

  it("waits for the first async-context probe before invoking a manual frame", async () => {
    setAsyncContextModeForTesting("auto");
    await runWithSpanFrame(ctx("first-manual"), async () => {
      await Promise.resolve();
      expect(ambientLabels()).toEqual(["first-manual"]);
    });
  });
});

describe("span context (sync-stack fallback)", () => {
  afterEach(() => {
    setAsyncContextModeForTesting("auto");
  });

  it("is correct for sequential nested flows and removes its own frame on settle", async () => {
    setAsyncContextModeForTesting("sync-stack");
    await runWithSpanContext(ctx("a"), async () => {
      expect(ambientLabels()).toEqual(["a"]);
      await runWithSpanContext(ctx("b"), async () => {
        expect(ambientLabels()).toEqual(["a", "b"]);
      });
      // After awaiting the inner withSpan, a's prologue is over — ambient stops.
      expect(ambientLabels()).toEqual([]);
    });
    expect(getAmbientSpanContexts()).toEqual([]);
  });

  it("removes its own frame even when it is no longer on top (interleaving-safe cleanup)", async () => {
    setAsyncContextModeForTesting("sync-stack");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    // Start flow1 but leave it parked on an await, then run flow2 to completion
    // while flow1's frame is still on the stack. flow2 must remove ITS frame
    // (not flow1's) even though flow1's frame sits beneath it. Ambient reads
    // never see suspended frames; stack depth pins the cleanup contract.
    const flow1 = ctx("flow1");
    const first = runWithSpanContext(flow1, async () => {
      await firstBlocked;
    });
    expect(syncStack).toHaveLength(1);
    expect(syncStack[0]?.context.spanId).toBe(flow1.spanId);
    expect(syncStack[0]?.prologueOpen).toBe(false);
    expect(ambientLabels()).toEqual([]);
    await runWithSpanContext(ctx("flow2"), async () => {
      expect(ambientLabels()).toEqual(["flow2"]);
      expect(syncStack.map((frame) => labelsBySpanId.get(frame.context.spanId))).toEqual(["flow1", "flow2"]);
    });
    expect(ambientLabels()).toEqual([]);
    expect(syncStack).toHaveLength(1);
    expect(syncStack[0]?.context.spanId).toBe(flow1.spanId);
    releaseFirst();
    await first;
    expect(getAmbientSpanContexts()).toEqual([]);
    expect(syncStack).toHaveLength(0);
  });

  it("sees prologue-open frames only; suspended frames of another flow are never ambient", async () => {
    setAsyncContextModeForTesting("sync-stack");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runWithSpanContext(ctx("flow1"), async () => {
      await firstBlocked;
    });
    // flow1 is suspended at its await: no longer ambient.
    expect(ambientLabels()).toEqual([]);
    await runWithSpanContext(ctx("flow2"), async () => {
      // flow2's synchronous prologue: ambient sees ONLY flow2 — this is the
      // property that makes cross-flow misattribution impossible.
      expect(ambientLabels()).toEqual(["flow2"]);
    });
    releaseFirst();
    await first;
    expect(getAmbientSpanContexts()).toEqual([]);
  });

  it("keeps outer frames ambient through SYNCHRONOUS nesting, and drops them after an await", async () => {
    setAsyncContextModeForTesting("sync-stack");
    await runWithSpanContext(ctx("a"), async () => {
      expect(ambientLabels()).toEqual(["a"]);
      await runWithSpanContext(ctx("b"), async () => {
        // b's prologue executes while a's callback is still mid-statement, so
        // both frames are provably the current flow.
        expect(ambientLabels()).toEqual(["a", "b"]);
      });
      // Back after an await: a's prologue is over — ambient fails closed.
      expect(ambientLabels()).toEqual([]);
    });
  });

  it("runWithSpanFrame re-binds a frame exactly for a synchronous window", async () => {
    setAsyncContextModeForTesting("sync-stack");
    const result = await runWithSpanFrame(ctx("manual"), () => {
      expect(ambientLabels()).toEqual(["manual"]);
      return 42;
    });
    expect(result).toBe(42);
    expect(getAmbientSpanContexts()).toEqual([]);
  });

  it("runWithSpanFrame drops ambient after the prologue but keeps the frame until settle for cleanup", async () => {
    setAsyncContextModeForTesting("sync-stack");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const callback = ctx("callback");
    const promise = runWithSpanFrame(callback, async () => {
      expect(ambientLabels()).toEqual(["callback"]);
      await blocked;
    });
    expect(ambientLabels()).toEqual([]);
    expect(syncStack).toHaveLength(1);
    expect(syncStack[0]?.context.spanId).toBe(callback.spanId);
    expect(syncStack[0]?.prologueOpen).toBe(false);
    release();
    await promise;
    // One extra microtask for the .finally(pop) chained on the result.
    await Promise.resolve();
    expect(getAmbientSpanContexts()).toEqual([]);
    expect(syncStack).toHaveLength(0);
  });

  it("runWithSpanFrame treats thenables as async for cleanup (not ambient after prologue)", async () => {
    setAsyncContextModeForTesting("sync-stack");
    const waiters: ((value: string) => void)[] = [];
    const thenable = {
      then: (resolve: (value: string) => void) => {
        waiters.push(resolve);
      },
    };

    const result = runWithSpanFrame(ctx("thenable"), () => thenable);
    expect(ambientLabels()).toEqual([]);
    expect(syncStack).toHaveLength(1);
    await Promise.resolve();
    for (const resolve of waiters) resolve("done");
    await expect(result).resolves.toBe("done");
    expect(getAmbientSpanContexts()).toEqual([]);
    expect(syncStack).toHaveLength(0);
  });
});
