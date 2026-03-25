import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerBatcher } from "./server-event-batcher";

function createSpanBatcher(sendBatch: any) {
  return new ServerBatcher({ sendBatch, payloadKey: "spans", maxPerBatch: 200 });
}

describe("ServerBatcher (spans)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers spans and flushes on interval", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    batcher.push({
      span_type: "test.op",
      span_id: "span-1",
      started_at_ms: 1000,
      ended_at_ms: 2000,
      data: {},
    }, null);

    expect(sendBatch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendBatch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(sendBatch.mock.calls[0][0]);
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].span_type).toBe("test.op");

    await batcher.stop();
  });

  it("flushes immediately when max spans reached", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    for (let i = 0; i < 200; i++) {
      batcher.push({
        span_type: "test.op",
        span_id: `span-${i}`,
        started_at_ms: 1000,
        ended_at_ms: 2000,
        data: {},
      }, null);
    }

    await vi.advanceTimersByTimeAsync(0);
    expect(sendBatch).toHaveBeenCalled();

    await batcher.stop();
  });

  it("groups spans by session", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    const session1 = { sessionKey: "session-1" } as any;
    const session2 = { sessionKey: "session-2" } as any;

    batcher.push({ span_type: "op1", span_id: "s1", started_at_ms: 1000, data: {} }, session1);
    batcher.push({ span_type: "op2", span_id: "s2", started_at_ms: 1000, data: {} }, session2);
    batcher.push({ span_type: "op3", span_id: "s3", started_at_ms: 1000, data: {} }, session1);

    await batcher.flush();

    expect(sendBatch).toHaveBeenCalledTimes(2);

    await batcher.stop();
  });

  it("does not accept spans after stop", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    await batcher.stop();

    batcher.push({ span_type: "test.op", span_id: "s1", started_at_ms: 1000, data: {} }, null);

    await batcher.flush();
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("flushes remaining spans on stop", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    batcher.push({ span_type: "test.op", span_id: "s1", started_at_ms: 1000, data: {} }, null);

    await batcher.stop();
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  it("does not flush when empty", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } });
    const batcher = createSpanBatcher(sendBatch);
    batcher.start();

    await batcher.flush();
    expect(sendBatch).not.toHaveBeenCalled();

    await batcher.stop();
  });
});
