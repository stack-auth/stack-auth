import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
// eslint-disable-next-line no-restricted-imports
import { waitUntil as waitUntilVercel } from "@vercel/functions";

export function runAsynchronouslyAndWaitUntil(promise: Promise<unknown>) {
  runAsynchronously(promise);
  waitUntilVercel(promise);
}
