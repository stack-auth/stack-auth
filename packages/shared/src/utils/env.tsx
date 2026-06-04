import { HexclaveAssertionError, throwErr } from "./errors";
import { deindent } from "./strings";

export function isBrowserLike() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement !== "undefined";
}

// newName: oldName
const ENV_VAR_RENAME: Record<string, string[]> = {
  NEXT_PUBLIC_STACK_API_URL: ['STACK_BASE_URL', 'NEXT_PUBLIC_STACK_URL'],
};

/**
 * Hexclave rebrand: compute the `HEXCLAVE_*`-prefixed equivalent of a `STACK_*`
 * env var name by replacing the first `STACK_` occurrence with `HEXCLAVE_`.
 * Covers `STACK_FOO`, `NEXT_PUBLIC_STACK_FOO`, `NEXT_PUBLIC_BROWSER_STACK_FOO`,
 * `NEXT_PUBLIC_SERVER_STACK_FOO`, `VITE_STACK_FOO`. Returns `undefined` when the
 * name has no `STACK_` segment (caller should behave exactly as before).
 */
function getHexclaveEnvVarName(name: string): string | undefined {
  if (!name.includes("STACK_")) {
    return undefined;
  }
  return name.replace("STACK_", "HEXCLAVE_");
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
    if (oldNames.includes(name)) {
      throwErr(`Environment variable ${name} has been renamed to ${newName}. Please update your configuration to use the new name.`);
    }
  }

  // Hexclave rebrand: prefer the HEXCLAVE_*-prefixed equivalent, fall back to the STACK_* name.
  const hexclaveName = getHexclaveEnvVarName(name);
  let value = (hexclaveName ? process.env[hexclaveName] : undefined) ?? process.env[name];

  // check the key under the old name if the new name is not found
  if (!value && ENV_VAR_RENAME[name] as any) {
    for (const oldName of ENV_VAR_RENAME[name]) {
      // Hexclave rebrand: also accept the HEXCLAVE_*-prefixed equivalent of each old alias.
      const hexclaveOldName = getHexclaveEnvVarName(oldName);
      value = (hexclaveOldName ? process.env[hexclaveOldName] : undefined) ?? process.env[oldName];
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
  const hexclaveName = getHexclaveEnvVarName(name);
  return (hexclaveName ? process.env[hexclaveName] : undefined) ?? process.env[name];
}
