import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
// eslint-disable-next-line no-restricted-imports
import { waitUntil as waitUntilVercel } from "@vercel/functions";

export function runAsynchronouslyAndWaitUntil<T>(promiseOrFunction: Promise<T> | (() => Promise<T>)) {
  const promise = typeof promiseOrFunction === "function" ? promiseOrFunction() : promiseOrFunction;
  runAsynchronously(promise);
  waitUntilVercel(promise);
}

export async function allPromisesAndWaitUntilEach(promises: Promise<unknown>[]): Promise<unknown[]> {
  for (const promise of promises) {
    waitUntilVercel(promise);
  }
  return await Promise.all(promises);
}
