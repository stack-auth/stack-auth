import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection, runAsynchronously } from "@hexclave/shared/dist/utils/promises";

// Serverful runtimes use this set for shutdown and the test-only flush endpoint.
// Vercel lifetime is owned separately by every invocation's native waitUntil.
const inFlightPromises = new Set<Promise<unknown>>();

function waitUntilImpl(promise: Promise<unknown>) {
  if (getEnvVariable("VERCEL", "") !== "") {
    // The same promise can be registered by separate Fluid invocations. Each
    // invocation needs its own waitUntil call, so do not globally deduplicate or
    // retain Vercel tasks in the serverful shutdown set.
    const { waitUntil } = require("@vercel/functions") as typeof import("@vercel/functions");
    waitUntil(promise);
    return;
  }

  if (inFlightPromises.has(promise)) return;
  inFlightPromises.add(promise);
  const cleanup = promise.finally(() => inFlightPromises.delete(promise));
  ignoreUnhandledRejection(cleanup);
}

export function runAsynchronouslyAndWaitUntil<T>(promiseOrFunction: Promise<T> | (() => Promise<T>)) {
  const promise = typeof promiseOrFunction === "function" ? promiseOrFunction() : promiseOrFunction;
  runAsynchronously(promise);
  waitUntilImpl(promise);
}

export async function allPromisesAndWaitUntilEach(promises: Promise<unknown>[]): Promise<unknown[]> {
  for (const promise of promises) {
    waitUntilImpl(promise);
  }
  return await Promise.all(promises);
}

async function awaitSettledWithDeadline(promises: Promise<unknown>[], deadline: number, timeoutMs: number): Promise<void> {
  const remainingMilliseconds = deadline - performance.now();
  if (remainingMilliseconds <= 0) {
    throw new HexclaveAssertionError(
      `Timed out after ${timeoutMs}ms while draining ${promises.length} background task(s).`,
    );
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), remainingMilliseconds);
    }),
  ]);
  if (timeout != null) {
    clearTimeout(timeout);
  }
  if (!completed) {
    throw new HexclaveAssertionError(
      `Timed out after ${timeoutMs}ms while draining ${promises.length} background task(s).`,
    );
  }
}

/**
 * Drains all in-flight background promises (non-Vercel only).
 * Called from the SIGTERM handler to allow background work to finish before exit.
 */
export async function drainInFlightPromises(timeoutMs = 8000): Promise<void> {
  const deadline = performance.now() + timeoutMs;

  // A task may enqueue another task while settling. Keep taking snapshots until
  // the set is empty so shutdown covers that transitive work as well. Requiring
  // an EMPTY set is only sound because ingress has already been stopped by the
  // time this runs — nothing else is enqueueing new tasks concurrently.
  while (inFlightPromises.size > 0) {
    await awaitSettledWithDeadline([...inFlightPromises], deadline, timeoutMs);
  }
}

/**
 * Awaits settlement of the background promises that are in flight at call time.
 * Used by the test-only flush-background-tasks endpoint.
 *
 * Unlike drainInFlightPromises, this must NOT wait for the set to become empty:
 * the flush endpoint runs while other requests (e.g. concurrently running E2E
 * test files) keep enqueueing new tasks into the same global set, so an
 * empty-set requirement chases a moving target and times out under load — this
 * is exactly what made CI's parallel E2E suites fail with drain timeouts.
 * Tasks transitively enqueued by the awaited ones are not covered; callers
 * that need those flushed can simply flush again.
 */
export async function flushInFlightPromises(timeoutMs = 45_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  const snapshot = [...inFlightPromises];
  if (snapshot.length === 0) return;
  await awaitSettledWithDeadline(snapshot, deadline, timeoutMs);
}

import.meta.vitest?.test("background tasks are tracked until they settle", async ({ expect }) => {
  let resolveTask: (() => void) | undefined;
  const task = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });

  runAsynchronouslyAndWaitUntil(task);
  await expect(drainInFlightPromises(1)).rejects.toThrow(
    "Timed out after 1ms while draining 1 background task(s).",
  );

  resolveTask?.();
  await task;
  await expect(drainInFlightPromises(100)).resolves.toBeUndefined();
});

import.meta.vitest?.test("background task draining includes work scheduled by a settling task", async ({ expect }) => {
  let resolveParent: (() => void) | undefined;
  let resolveNested: (() => void) | undefined;
  const nestedTask = new Promise<void>((resolve) => {
    resolveNested = resolve;
  });
  const parentTask = new Promise<void>((resolve) => {
    resolveParent = () => {
      runAsynchronouslyAndWaitUntil(nestedTask);
      resolve();
    };
  });

  runAsynchronouslyAndWaitUntil(parentTask);
  const drainPromise = drainInFlightPromises(100);
  resolveParent?.();
  await parentTask;
  await Promise.resolve();

  expect(await Promise.race([
    drainPromise.then(() => "drained"),
    Promise.resolve("still-draining"),
  ])).toBe("still-draining");

  resolveNested?.();
  await expect(drainPromise).resolves.toBeUndefined();
});

import.meta.vitest?.test("flushing awaits the call-time snapshot but not tasks enqueued afterwards", async ({ expect }) => {
  let resolveEarly: (() => void) | undefined;
  let resolveLate: (() => void) | undefined;
  const earlyTask = new Promise<void>((resolve) => {
    resolveEarly = resolve;
  });
  const lateTask = new Promise<void>((resolve) => {
    resolveLate = resolve;
  });

  runAsynchronouslyAndWaitUntil(earlyTask);
  const flushPromise = flushInFlightPromises(1000);
  // Enqueued after the flush call: must not block the flush (this is what other
  // concurrently-running requests look like to the flush endpoint).
  runAsynchronouslyAndWaitUntil(lateTask);

  resolveEarly?.();
  await expect(flushPromise).resolves.toBeUndefined();

  resolveLate?.();
  await lateTask;
  await drainInFlightPromises(100);
});

import.meta.vitest?.test("flushing times out loudly when a call-time task hangs", async ({ expect }) => {
  let resolveHanging: (() => void) | undefined;
  const hangingTask = new Promise<void>((resolve) => {
    resolveHanging = resolve;
  });

  runAsynchronouslyAndWaitUntil(hangingTask);
  await expect(flushInFlightPromises(1)).rejects.toThrow(
    "Timed out after 1ms while draining 1 background task(s).",
  );

  resolveHanging?.();
  await hangingTask;
});
