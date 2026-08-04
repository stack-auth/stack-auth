import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection, runAsynchronously } from "@hexclave/shared/dist/utils/promises";

// Track on every runtime. Vercel's waitUntil owns function lifetime, while this
// set gives shutdown and the test-only flush endpoint a deterministic drain.
const inFlightPromises = new Set<Promise<unknown>>();

function waitUntilImpl(promise: Promise<unknown>) {
  if (inFlightPromises.has(promise)) {
    return;
  }

  inFlightPromises.add(promise);
  const cleanup = promise.finally(() => inFlightPromises.delete(promise));
  ignoreUnhandledRejection(cleanup);

  if (getEnvVariable("VERCEL", "") !== "") {
    // On Vercel, use the native waitUntil to keep the function alive
    const { waitUntil } = require("@vercel/functions") as typeof import("@vercel/functions");
    waitUntil(promise);
  }
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

/**
 * Drains all in-flight background promises (non-Vercel only).
 * Called from the SIGTERM handler to allow background work to finish before exit.
 */
export async function drainInFlightPromises(timeoutMs = 8000): Promise<void> {
  const deadline = performance.now() + timeoutMs;

  // A task may enqueue another task while settling. Keep taking snapshots until
  // the set is empty so shutdown covers that transitive work as well.
  while (inFlightPromises.size > 0) {
    const remainingMilliseconds = deadline - performance.now();
    if (remainingMilliseconds <= 0) {
      throw new HexclaveAssertionError(
        `Timed out after ${timeoutMs}ms while draining ${inFlightPromises.size} background task(s).`,
      );
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      Promise.allSettled([...inFlightPromises]).then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), remainingMilliseconds);
      }),
    ]);
    if (timeout != null) {
      clearTimeout(timeout);
    }
    if (!completed) {
      throw new HexclaveAssertionError(
        `Timed out after ${timeoutMs}ms while draining ${inFlightPromises.size} background task(s).`,
      );
    }
  }
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
