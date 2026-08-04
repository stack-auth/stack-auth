import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";

export const CONFIG_FILE_CANDIDATES = ["hexclave.config.ts", "hexclave.config.js", "stack.config.ts", "stack.config.js"];

export type DeployOptions = {
  config?: string,
  cloudProjectId?: string,
  secret: string[],
};

export const SECRET_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;
export const ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CONNECTION_VALUE_REGEX = /^[a-zA-Z0-9_-]+\.[A-Za-z0-9_]+$/;

export function parseSecretOptions(secretOptions: string[]): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const option of secretOptions) {
    const separatorIndex = option.indexOf("=");
    if (separatorIndex <= 0) {
      throw new CliError(`Invalid --secret value ${JSON.stringify(option)}. Expected the KEY=VALUE format.`);
    }
    const key = option.slice(0, separatorIndex);
    const value = option.slice(separatorIndex + 1);
    if (!SECRET_KEY_REGEX.test(key)) {
      throw new CliError(`Invalid --secret key ${JSON.stringify(key)}. Secret keys must contain only letters, numbers, underscores, and hyphens.`);
    }
    if (secrets.has(key)) {
      throw new CliError(`Duplicate --secret key ${JSON.stringify(key)}.`);
    }
    secrets.set(key, value);
  }
  return secrets;
}

export const DEPLOYMENTS_CONFIG_SECTION = "deployments-alpha";

export type ServiceEnvVarConfig =
  | { value: string }
  | { type: "secret", key: string }
  | { type: "connection", value: string };

export type ServiceDefinition = {
  framework?: string,
  installCommand?: string,
  buildCommand?: string,
  outputDirectory?: string,
  rootDirectory?: string,
  env: Record<string, ServiceEnvVarConfig>,
};

export function extractServiceDefinition(config: unknown, serviceName: string): ServiceDefinition {
  if (config == null || typeof config !== "object") {
    throw new CliError("Config file must export a plain `config` object.");
  }
  const section = (config as Record<string, unknown>)[DEPLOYMENTS_CONFIG_SECTION];
  const services = section != null && typeof section === "object" ? (section as { services?: unknown }).services : undefined;
  if (services == null || typeof services !== "object") {
    throw new CliError(`The config file has no \`${DEPLOYMENTS_CONFIG_SECTION}.services\` section. Add one, e.g.:\n  export const config = {\n    "${DEPLOYMENTS_CONFIG_SECTION}": {\n      services: {\n        ${serviceName}: { type: "vercel", rootDirectory: "./", framework: "nextjs" },\n      },\n    },\n  };`);
  }
  const service = (services as Record<string, unknown>)[serviceName];
  if (service == null || typeof service !== "object") {
    const available = Object.keys(services);
    throw new CliError(`No service named ${JSON.stringify(serviceName)} in the config file's \`${DEPLOYMENTS_CONFIG_SECTION}.services\`.${available.length > 0 ? ` Available services: ${available.join(", ")}` : ""}`);
  }
  const record = service as Record<string, unknown>;
  if (record.type !== "vercel") {
    throw new CliError(record.type === undefined
      ? `\`${DEPLOYMENTS_CONFIG_SECTION}.services.${serviceName}\` has no \`type\`. Add \`type: "vercel"\`.`
      : `\`${DEPLOYMENTS_CONFIG_SECTION}.services.${serviceName}.type\` must be "vercel" (got ${JSON.stringify(record.type)}).`);
  }
  const readString = (key: string): string | undefined => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new CliError(`\`${DEPLOYMENTS_CONFIG_SECTION}.services.${serviceName}.${key}\` must be a string.`);
    }
    return value;
  };
  return {
    framework: readString("framework"),
    installCommand: readString("installCommand"),
    buildCommand: readString("buildCommand"),
    outputDirectory: readString("outputDirectory"),
    rootDirectory: readString("rootDirectory"),
    env: extractServiceEnv(record.env, serviceName),
  };
}

function extractServiceEnv(env: unknown, serviceName: string): Record<string, ServiceEnvVarConfig> {
  if (env === undefined) return {};
  if (env == null || typeof env !== "object" || Array.isArray(env)) {
    throw new CliError(`\`${DEPLOYMENTS_CONFIG_SECTION}.services.${serviceName}.env\` must be a record of env var entries, e.g. { MY_VAR: { value: "some-value" } }.`);
  }
  const result: Record<string, ServiceEnvVarConfig> = {};
  for (const [envVarKey, entryValue] of Object.entries(env as Record<string, unknown>)) {
    const path = `\`${DEPLOYMENTS_CONFIG_SECTION}.services.${serviceName}.env.${envVarKey}\``;
    if (!ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new CliError(`${path} has an invalid key. Env var keys must start with a letter or underscore and contain only letters, digits, and underscores.`);
    }
    if (entryValue == null || typeof entryValue !== "object") {
      throw new CliError(`${path} must be an object like { value: "..." }, { type: "secret", key: "..." }, or { type: "connection", value: "service.output" }.`);
    }
    const entry = entryValue as { type?: unknown, value?: unknown, key?: unknown };
    switch (entry.type) {
      case undefined: {
        if (typeof entry.value !== "string") {
          throw new CliError(`${path} must have a string \`value\` (or a \`type\` of "secret" or "connection").`);
        }
        if (entry.key !== undefined) {
          throw new CliError(`${path} must not have a \`key\` — that's only for env vars with \`type: "secret"\`.`);
        }
        result[envVarKey] = { value: entry.value };
        break;
      }
      case "secret": {
        if (typeof entry.key !== "string" || !SECRET_KEY_REGEX.test(entry.key)) {
          throw new CliError(`${path} has type "secret" and must have a \`key\` naming the secret to pass at deploy time (letters, numbers, underscores, and hyphens only).`);
        }
        if (entry.value !== undefined) {
          throw new CliError(`${path} has type "secret" and must not have a \`value\` — pass it at deploy time with --secret ${entry.key}=<value> instead, so it is never committed.`);
        }
        result[envVarKey] = { type: "secret", key: entry.key };
        break;
      }
      case "connection": {
        if (typeof entry.value !== "string" || !CONNECTION_VALUE_REGEX.test(entry.value)) {
          throw new CliError(`${path} has type "connection" and must have a \`value\` referencing a service output like "hexclave.projectId".`);
        }
        result[envVarKey] = { type: "connection", value: entry.value };
        break;
      }
      default: {
        throw new CliError(`${path} has an unknown \`type\` ${JSON.stringify(entry.type)}. Supported: "secret", "connection", or no type for a plain value.`);
      }
    }
  }
  return result;
}

export function assertSecretsMatchEnv(env: Record<string, ServiceEnvVarConfig>, secrets: ReadonlyMap<string, string>): void {
  const referencedKeys = new Set(Object.values(env).flatMap((entry) => "type" in entry && entry.type === "secret" ? [entry.key] : []));
  const missing = [...referencedKeys].filter((key) => !secrets.has(key));
  if (missing.length > 0) {
    throw new CliError(`Missing secret values for: ${missing.join(", ")}. This service's env vars reference these secrets — pass them with --secret <key>=<value>.`);
  }
  const unused = [...secrets.keys()].filter((key) => !referencedKeys.has(key));
  if (unused.length > 0) {
    throw new CliError(`Unknown --secret key(s): ${unused.join(", ")}. No env var of this service references them — check for typos, or add an env var with \`type: "secret"\` referencing them.`);
  }
}

export function resolveDeployConfigPath(configOption: string | undefined, cwd: string): string | undefined {
  if (configOption != null && configOption !== "") {
    const resolved = path.resolve(cwd, configOption);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new CliError(`Config file not found: ${resolved}`);
    }
    return resolved;
  }
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }
  return undefined;
}
