/**
 * Shared-secret authentication for the bulldozer-js service.
 *
 * bulldozer-js is an internal service: only the backend should ever call it, and
 * the backend attaches `Authorization: Bearer <secret>` on every request (see
 * apps/backend/src/lib/bulldozer-server-client.ts). This predicate is the check
 * the service runs on every request — there is no per-tenant auth, the tenant is
 * just a path segment, so this shared secret is what stands between a caller and
 * every tenant's payment data.
 *
 * Kept as a pure function in its own module (no env reads, no server) so it is
 * unit-testable without importing `index.ts`, which starts the HTTP server at
 * import time.
 */
export function isBulldozerRequestAuthorized(authHeader: string | null, secret: string): boolean {
  // An empty secret never authorizes. The startup check in index.ts already
  // refuses to boot without a secret, so in practice `secret` is non-empty here;
  // this guard keeps the predicate correct (fail-closed) even if called otherwise.
  return secret.length > 0 && authHeader === `Bearer ${secret}`;
}

import.meta.vitest?.describe("isBulldozerRequestAuthorized", (test) => {
  test("authorizes a request whose bearer matches the secret", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("Bearer s3cr3t", "s3cr3t")).toBe(true);
  });

  test("rejects a wrong secret", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("Bearer wrong", "s3cr3t")).toBe(false);
  });

  test("rejects a missing (null) header", ({ expect }) => {
    expect(isBulldozerRequestAuthorized(null, "s3cr3t")).toBe(false);
  });

  test("rejects an empty header", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("", "s3cr3t")).toBe(false);
  });

  test("rejects the bare secret without the Bearer prefix", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("s3cr3t", "s3cr3t")).toBe(false);
  });

  test("rejects a Bearer with the wrong case prefix", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("bearer s3cr3t", "s3cr3t")).toBe(false);
  });

  test("never authorizes when the configured secret is empty (fail-closed)", ({ expect }) => {
    expect(isBulldozerRequestAuthorized("Bearer ", "")).toBe(false);
    expect(isBulldozerRequestAuthorized(null, "")).toBe(false);
    expect(isBulldozerRequestAuthorized("Bearer anything", "")).toBe(false);
  });
});
