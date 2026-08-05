import { requestContextALS, type RequestContext } from "@/lib/runtime/request-context";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { expect, test } from "vitest";
import { RequestLifetime, RouteTimeoutError } from "./request-lifetime";

function createTestLifetime(normalizedPath = "/api/latest/test") {
  return new RequestLifetime({
    drainGraceMs: 50,
    maxDurationMs: 200,
    normalizedPath,
    startedAt: performance.now(),
    terminationBufferMs: 20,
  });
}

function createTestContext(lifetime: RequestLifetime): RequestContext {
  return {
    headers: new Headers(),
    incomingCookies: new Map(),
    pendingSetCookies: [],
    deletedCookies: [],
    lifetime,
    normalizedPath: "/api/latest/test",
  };
}

test("a timed-out handler receives an abort and finishes cleanup before returning 504", async () => {
  const lifetime = createTestLifetime();
  let cleanupFinished = false;
  const startedAt = performance.now();

  await expect(lifetime.runHandler(async (signal) => await new Promise<string>((resolve) => {
    signal.addEventListener("abort", () => {
      setTimeout(() => {
        cleanupFinished = true;
        resolve("finished after cancellation");
      }, 1);
    }, { once: true });
  }))).rejects.toBeInstanceOf(RouteTimeoutError);

  expect({ aborted: lifetime.signal.aborted, cleanupFinished }).toEqual({
    aborted: true,
    cleanupFinished: true,
  });
  expect(performance.now() - startedAt).toBeLessThan(250);
});

test("background work registered by a route keeps its deadline and drains after the response", async () => {
  const lifetime = createTestLifetime();
  const context = createTestContext(lifetime);
  let task: Promise<void> | undefined;

  const result = await requestContextALS.run(context, async () => await lifetime.runHandler(async (signal) => {
    task = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        setTimeout(resolve, 1);
      }, { once: true });
    });
    runAsynchronouslyAndWaitUntil(task);
    return "started";
  }));

  expect(result).toBe("started");
  if (task == null) {
    throw new Error("The test route should have registered its background task");
  }
  await expect(task).resolves.toBeUndefined();
  expect(lifetime.signal.aborted).toBe(true);
});

test("a non-cooperative background task releases invocation ownership at the hard deadline", async () => {
  const lifetime = createTestLifetime();
  let resolveTask: (() => void) | undefined;
  const task = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });
  const ownership = lifetime.trackBackgroundTask(task);

  await expect(lifetime.runHandler(async () => "started")).resolves.toBe("started");
  await expect(ownership).rejects.toBeInstanceOf(RouteTimeoutError);

  resolveTask?.();
  await task;
});

test("an already-expired lifetime never invokes its handler", async () => {
  const lifetime = new RequestLifetime({
    drainGraceMs: 50,
    maxDurationMs: 200,
    normalizedPath: "/api/latest/expired",
    startedAt: performance.now() - 1000,
    terminationBufferMs: 20,
  });
  let invoked = false;

  await expect(lifetime.runHandler(async () => {
    invoked = true;
    return "too late";
  })).rejects.toBeInstanceOf(RouteTimeoutError);

  expect({ invoked, aborted: lifetime.signal.aborted }).toEqual({
    invoked: false,
    aborted: true,
  });
});

test("a streaming response remains owned and is cancelled when its route expires", async () => {
  const lifetime = createTestLifetime();
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({
    pull: async () => await new Promise(() => {}),
    cancel: () => {
      cancelled = true;
    },
  });

  const response = await lifetime.runHandler(async () => lifetime.ownResponse(new Response(upstream)));
  const read = response.body?.getReader().read();
  if (read == null) {
    throw new Error("The test response should have a body");
  }

  await expect(read).rejects.toBeInstanceOf(RouteTimeoutError);
  expect({ cancelled, aborted: lifetime.signal.aborted }).toEqual({
    cancelled: true,
    aborted: true,
  });
});

test("background work cannot attach after a request lifetime is disposed", async () => {
  const lifetime = createTestLifetime();
  await expect(lifetime.runHandler(async () => "done")).resolves.toBe("done");

  expect(() => lifetime.trackBackgroundTask(Promise.resolve())).toThrow(
    "registered background work after its request lifetime ended",
  );
});

test("duplicate background registration gives every owner a bounded rejection", async () => {
  const lifetime = createTestLifetime();
  let resolveTask: (() => void) | undefined;
  const task = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });
  const firstOwnership = lifetime.trackBackgroundTask(task);
  const secondOwnership = lifetime.trackBackgroundTask(task);

  await lifetime.runHandler(async () => "started");
  const outcomes = await Promise.allSettled([firstOwnership, secondOwnership]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);

  resolveTask?.();
  await task;
});

test("one request timing out does not abort a concurrent request", async () => {
  const shortLifetime = createTestLifetime("/api/latest/short");
  const longLifetime = new RequestLifetime({
    drainGraceMs: 50,
    maxDurationMs: 400,
    normalizedPath: "/api/latest/long",
    startedAt: performance.now(),
    terminationBufferMs: 20,
  });

  const shortRequest = shortLifetime.runHandler(async (signal) => await new Promise<string>((resolve) => {
    signal.addEventListener("abort", () => resolve("short-cleanup"), { once: true });
  }));
  const longRequest = longLifetime.runHandler(async () => await new Promise<string>((resolve) => {
    setTimeout(() => resolve("long-finished"), 180);
  }));

  await expect(shortRequest).rejects.toBeInstanceOf(RouteTimeoutError);
  await expect(longRequest).resolves.toBe("long-finished");
  expect(longLifetime.signal.aborted).toBe(false);
});
