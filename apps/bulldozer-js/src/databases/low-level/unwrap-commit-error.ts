import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

/**
 * LMDB rejects failed writes as `Error("Commit failed (see commitError for details)")`
 * with `.commitError` set to a Promise that later rejects with the real native status
 * (ENOSPC, MDB_MAP_FULL, …). Await that before rethrowing/logging, or you only see the
 * opaque wrapper.
 *
 * Why awaiting works: in lmdb/write.js, `rejectCommit()` attaches the Promise and rejects
 * the write; then in the *same* sync callback, `commitRejectPromise.reject(lmdbError(status))`
 * settles it. By the time our microtask runs, `.commitError` already has the real error.
 */
export async function unwrapLmdbCommitError(error: unknown): Promise<unknown> {
  if (!(error instanceof Error) || !("commitError" in error)) return error;

  const settled = error.commitError instanceof Promise
    ? await error.commitError.then(value => value, rejected => rejected)
    : error.commitError;

  if (settled instanceof Error) return settled;

  return new HexclaveAssertionError(
    "LMDB commit failed but commitError did not settle to an Error",
    { cause: error, commitError: settled },
  );
}
