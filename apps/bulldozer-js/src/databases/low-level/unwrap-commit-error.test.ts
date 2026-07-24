import { describe, expect, it } from "vitest";
import { unwrapLmdbCommitError } from "./unwrap-commit-error.js";

describe("unwrapLmdbCommitError", () => {
  it("passes through values that are not LMDB commit wrappers", async () => {
    expect(await unwrapLmdbCommitError("plain")).toBe("plain");
    const ordinary = new Error("ordinary failure");
    expect(await unwrapLmdbCommitError(ordinary)).toBe(ordinary);
  });

  it("returns the underlying error after LMDB's rejectCommit → commitRejectPromise.reject sequence", async () => {
    // Mirrors lmdb/write.js: rejectCommit() attaches an unsettled Promise and rejects
    // the write; then the same sync callback settles that Promise with lmdbError(status).
    let rejectCommitError!: (error: Error) => void;
    const commitError = new Promise<never>((_resolve, reject) => {
      rejectCommitError = reject;
    });
    commitError.catch(() => {});

    const wrapper = Object.assign(new Error("Commit failed (see commitError for details)"), { commitError });
    const underlying = new Error("ENOSPC: no space left on device");

    const unwrappedPromise = unwrapLmdbCommitError(wrapper);
    rejectCommitError(underlying);

    expect(await unwrappedPromise).toBe(underlying);
  });

  it("returns HexclaveAssertionError when commitError does not settle to an Error", async () => {
    const wrapper = Object.assign(new Error("Commit failed (see commitError for details)"), {
      commitError: Promise.resolve("not-an-error"),
    });
    const result = await unwrapLmdbCommitError(wrapper);
    expect(result).toMatchObject({ name: "HexclaveAssertionError" });
  });
});
