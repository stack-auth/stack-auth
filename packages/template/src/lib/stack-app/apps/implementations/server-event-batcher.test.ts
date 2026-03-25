import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { ServerBatcher } from "./server-event-batcher";

function createMockSession(key: string): InternalSession {
  return {
    sessionKey: key,
    isKnownToBeInvalid: () => false,
  } as unknown as InternalSession;
}

const flushTimersAndMicrotasks = async () => {
  vi.advanceTimersByTime(10_000);
  await Promise.resolve();
  await Promise.resolve();
};

function createBatcher(sendBatch: any) {
  return new ServerBatcher({ sendBatch, payloadKey: "events", maxPerBatch: 50 });
}

describe("ServerBatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers events and flushes on interval tick", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    const session = createMockSession("session-1");
    batcher.push({
      event_type: "checkout.completed",
      event_at_ms: Date.now(),
      data: { amount: 4200 },
    }, session);

    expect(sendBatch).not.toHaveBeenCalled();

    await flushTimersAndMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: { event_type: string }[],
    };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].event_type).toBe("checkout.completed");

    await batcher.stop();
  });

  it("flushes immediately when event count threshold is reached", async () => {
    vi.useFakeTimers();

    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    const session = createMockSession("session-1");
    for (let i = 0; i < 50; i++) {
      batcher.push({
        event_type: `event.${i}`,
        event_at_ms: Date.now(),
        data: {},
      }, session);
    }

    await Promise.resolve();
    await Promise.resolve();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: { event_type: string }[],
    };
    expect(payload.events).toHaveLength(50);

    await batcher.stop();
  });

  it("groups events by session into separate batches", async () => {
    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    const session1 = createMockSession("session-a");
    const session2 = createMockSession("session-b");

    batcher.push({ event_type: "user.a.event", event_at_ms: Date.now(), data: {} }, session1);
    batcher.push({ event_type: "user.b.event", event_at_ms: Date.now(), data: {} }, session2);
    batcher.push({ event_type: "user.a.event2", event_at_ms: Date.now(), data: {} }, session1);

    await batcher.flush();

    expect(sendBatch).toHaveBeenCalledTimes(2);

    const payloads = sendBatch.mock.calls.map(
      (call) => JSON.parse(call[0]) as { events: { event_type: string }[] }
    );

    const sessionABatch = payloads.find((p) => p.events[0].event_type === "user.a.event");
    const sessionBBatch = payloads.find((p) => p.events[0].event_type === "user.b.event");

    expect(sessionABatch?.events).toHaveLength(2);
    expect(sessionBBatch?.events).toHaveLength(1);

    await batcher.stop();
  });

  it("handles null session events", async () => {
    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    batcher.push({ event_type: "project.scoped", event_at_ms: Date.now(), data: {} }, null);

    await batcher.flush();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][1]).toBeNull();

    await batcher.stop();
  });

  it("is a no-op when flushing an empty buffer", async () => {
    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    await batcher.flush();

    expect(sendBatch).not.toHaveBeenCalled();

    await batcher.stop();
  });

  it("flushes remaining events on stop", async () => {
    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();

    const session = createMockSession("session-1");
    batcher.push({ event_type: "last.event", event_at_ms: Date.now(), data: {} }, session);

    await batcher.stop();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendBatch.mock.calls[0][0]) as {
      events: { event_type: string }[],
    };
    expect(payload.events[0].event_type).toBe("last.event");
  });

  it("does not accept events after stop", async () => {
    const sendBatch = vi.fn(async (_body: string, _session: InternalSession | null, _opts: { keepalive: boolean }) => {
      return Result.ok(new Response("ok", { status: 200 }));
    });

    const batcher = createBatcher(sendBatch);
    batcher.start();
    await batcher.stop();

    batcher.push({ event_type: "late.event", event_at_ms: Date.now(), data: {} }, null);

    await batcher.flush();

    expect(sendBatch).not.toHaveBeenCalled();
  });
});
