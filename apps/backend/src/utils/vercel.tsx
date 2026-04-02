import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

/**
 * In-flight background promises tracked for graceful shutdown on non-Vercel runtimes (e.g. Cloud Run).
 * On SIGTERM, we drain these before exiting. See SIGTERM handler in prisma-client.tsx.
 */
const inFlightPromises = new Set<Promise<unknown>>();

const isVercel = !!getEnvVariable("VERCEL", "");

function waitUntilImpl(promise: Promise<unknown>) {
  if (isVercel) {
    // On Vercel, use the native waitUntil to keep the function alive
    // eslint-disable-next-line no-restricted-imports, @typescript-eslint/no-require-imports
    const { waitUntil } = require("@vercel/functions") as typeof import("@vercel/functions");
    waitUntil(promise);
  } else {
    // On Cloud Run / self-hosted: track the promise for SIGTERM drain
    inFlightPromises.add(promise);
    runAsynchronously(promise.finally(() => inFlightPromises.delete(promise)));
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
  if (inFlightPromises.size === 0) return;
  await Promise.race([
    Promise.allSettled([...inFlightPromises]),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}
