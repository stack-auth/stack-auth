import { HexclaveAssertionError, throwErr } from "./errors";
import { deindent } from "./strings";

export function isBrowserLike() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement !== "undefined";
}

// newName: oldName
const ENV_VAR_RENAME: Record<string, string[] | undefined> = {
  NEXT_PUBLIC_STACK_API_URL: ['STACK_BASE_URL', 'NEXT_PUBLIC_STACK_URL'],
};

export function resolveHexclaveStackEnvVarValue(hexclaveName: string, stackName: string, hexclaveValue: string | undefined, stackValue: string | undefined): string | undefined {
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

/**
 * Hexclave rebrand: resolve an env var by reading both the `HEXCLAVE_*` and
 * `STACK_*` spellings, preferring the canonical Hexclave value and falling back
 * to the legacy Stack value (empty counts as unset). Works in BOTH directions —
 * whether the caller passes the legacy `STACK_FOO` name or the canonical
 * `HEXCLAVE_FOO` name, the other spelling is still honored. Covers `STACK_FOO`,
 * `NEXT_PUBLIC_STACK_FOO`, `NEXT_PUBLIC_BROWSER_STACK_FOO`,
 * `NEXT_PUBLIC_SERVER_STACK_FOO`, `VITE_STACK_FOO` and their HEXCLAVE_ twins.
 * Names with neither segment behave exactly as before.
 */
function getEnvVarWithHexclaveFallback(name: string): string | undefined {
  if (name.includes("STACK_")) {
    const hexclaveName = name.replace("STACK_", "HEXCLAVE_");
    return resolveHexclaveStackEnvVarValue(hexclaveName, name, process.env[hexclaveName], process.env[name]);
  }
  if (name.includes("HEXCLAVE_")) {
    const stackName = name.replace("HEXCLAVE_", "STACK_");
    return resolveHexclaveStackEnvVarValue(name, stackName, process.env[name], process.env[stackName]);
  }
  return process.env[name];
}

/**
 * Returns the environment variable with the given name, returning the default (if given) or throwing an error (otherwise) if it's undefined or the empty string.
 */
export function getEnvVariable(name: string, defaultValue?: string | undefined): string {
  if (isBrowserLike()) {
    throw new Error(deindent`
      Can't use getEnvVariable on the client because Next.js transpiles expressions of the kind process.env.XYZ at build-time on the client.
    
      Use process.env.XYZ directly instead.
    `);
  }
  if (name === "NEXT_RUNTIME") {
    throw new Error(deindent`
      Can't use getEnvVariable to access the NEXT_RUNTIME environment variable because it's compiled into the client bundle.
    
      Use getNextRuntime() instead.
    `);
  }

  // throw error if the old name is used as the retrieve key
  for (const [newName, oldNames] of Object.entries(ENV_VAR_RENAME)) {
    if (oldNames?.includes(name)) {
      throwErr(`Environment variable ${name} has been renamed to ${newName}. Please update your configuration to use the new name.`);
    }
  }

  // Hexclave rebrand: prefer the HEXCLAVE_*-prefixed equivalent, fall back to the STACK_* name.
  // Treat the empty string as unset — the checked-in .env templates define empty
  // HEXCLAVE_* placeholders, which must not shadow a real value under the legacy name.
  let value = getEnvVarWithHexclaveFallback(name);

  // check the key under the old name if the new name is not found
  const renamedNames = ENV_VAR_RENAME[name];
  if (!value && renamedNames != null) {
    for (const oldName of renamedNames) {
      value = getEnvVarWithHexclaveFallback(oldName);
      if (value) break;
    }
  }

  if (!value) {
    if (defaultValue !== undefined) {
      value = defaultValue;
    } else {
      throwErr(`Missing environment variable: ${name}`);
    }
  }

  return value;
}

export function getEnvBoolean(name: string): boolean {
  const value = getEnvVariable(name, "false");
  if (value === "true") {
    return true;
  } else if (value === "false") {
    return false;
  } else {
    throw new HexclaveAssertionError(`Environment variable ${name} must be either "true" or "false": found ${JSON.stringify(value)}`);
  }
}

export function getNextRuntime() {
  // This variable is compiled into the client bundle, so we can't use getEnvVariable here.
  return process.env.NEXT_RUNTIME || throwErr("Missing environment variable: NEXT_RUNTIME");
}

export function getNodeEnvironment() {
  return getEnvVariable("NODE_ENV", "");
}

/**
 * Browser-safe access to `process.env` for server-only or genuinely dynamic
 * env-var lookups. Returns `undefined` when `process` is not defined (e.g. in
 * a Vite browser bundle without a `process` shim).
 *
 * Note: uses `process.env[name]` (bracket form), which is NOT recognized by
 * Next.js / webpack DefinePlugin for compile-time inlining. If you need
 * build-time inlining for a `NEXT_PUBLIC_*` var, use the literal dot-form at
 * the call site, guarded with `typeof process`:
 *
 *   const value = (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FOO : undefined);
 */
export function getProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    return undefined;
  }
  // Hexclave rebrand: prefer the HEXCLAVE_*-prefixed equivalent, fall back to the STACK_* name.
  // Empty counts as unset — the checked-in .env templates define empty HEXCLAVE_* placeholders,
  // which must not shadow a real value under the legacy name.
  return getEnvVarWithHexclaveFallback(name);
}
