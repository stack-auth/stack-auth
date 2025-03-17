import { throwErr } from "./errors";
import { deindent } from "./strings";

export function isBrowserLike() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement !== "undefined";
}

// newName: oldName
const ENV_VAR_RENAME: Record<string, string[]> = {
  NEXT_PUBLIC_STACK_API_URL: ['STACK_BASE_URL', 'NEXT_PUBLIC_STACK_URL'],
};

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

  let value = process.env[name];

  // check the key under the old name if the new name is not found
  if (!value && ENV_VAR_RENAME[name] as any) {
    for (const oldName of ENV_VAR_RENAME[name]) {
      value = process.env[oldName];
      if (value) break;
    }
  }

  if (value === undefined) {
    if (defaultValue !== undefined) {
      value = defaultValue;
    } else {
      throwErr(`Missing environment variable: ${name}`);
    }
  }

  return value;
}

export function getNextRuntime() {
  // This variable is compiled into the client bundle, so we can't use getEnvVariable here.
  return process.env.NEXT_RUNTIME || throwErr("Missing environment variable: NEXT_RUNTIME");
}

export function getNodeEnvironment() {
  return getEnvVariable("NODE_ENV", "");
}
