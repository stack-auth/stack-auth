/**
 * Resolve the test database connection string from the environment, preferring
 * the canonical `HEXCLAVE_DATABASE_CONNECTION_STRING` and falling back to the
 * legacy `STACK_DATABASE_CONNECTION_STRING`. Empty counts as unset. Throws when
 * both names are set to different non-empty values, or when neither is set.
 *
 * Shared by the bulldozer/payments DB-backed vitest suites so the dual-read
 * stays consistent with the rest of the Hexclave rebrand.
 */
export function resolveTestDatabaseConnectionString(): string {
  const env = Reflect.get(import.meta, "env");
  const hexclaveRaw = Reflect.get(env, "HEXCLAVE_DATABASE_CONNECTION_STRING");
  const stackRaw = Reflect.get(env, "STACK_DATABASE_CONNECTION_STRING");
  const hexclaveValue = typeof hexclaveRaw === "string" && hexclaveRaw.length > 0 ? hexclaveRaw : undefined;
  const stackValue = typeof stackRaw === "string" && stackRaw.length > 0 ? stackRaw : undefined;
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error("Environment variables HEXCLAVE_DATABASE_CONNECTION_STRING and STACK_DATABASE_CONNECTION_STRING are both set to different values. Remove one of them or set them to the same value.");
  }
  const value = hexclaveValue || stackValue;
  if (!value) {
    throw new Error("Missing environment variable HEXCLAVE_DATABASE_CONNECTION_STRING or STACK_DATABASE_CONNECTION_STRING.");
  }
  return value;
}
