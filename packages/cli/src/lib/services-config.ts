// Evaluates the `services` export of hexclave.config.ts.
//
// The export is a FUNCTION, not a plain object:
//
//   export const services = ({ isDev, secret, service, hexclave }) => ({
//     frontend: {
//       type: "vercel",
//       framework: "next",
//       devCommand: "pnpm dev",
//       env: {
//         DB_URL: service("database").url,
//         OPENAI: isDev ? null : secret("OPENAI_API_KEY", "some-default"),
//         PROJECT_ID: hexclave.projectId,
//       },
//     },
//     database: { ... },
//   });
//
// `secret()`, `service()` and `hexclave.*` return SENTINEL objects (in deploy
// mode) that this module serializes into the wire-shape definitions the
// backend stores — the function itself never sees real secret or connection
// values. In dev mode (`hexclave dev --service-id ...`) the context behaves
// differently: `secret()` resolves to its default value (secrets are never
// fetched during dev), `service()` returns null (guard connection values with
// `isDev`), and `hexclave.*` resolves from the development-environment
// session's credentials.
//
// Everything here is validated at runtime with precise errors rather than
// through a typed wrapper: the config file is arbitrary user TypeScript loaded
// via jiti, so compile-time checking of service ids can't be enforced from our
// side anyway.

import {
  DEPLOYMENT_ENV_VAR_KEY_REGEX,
  DEPLOYMENT_SECRET_KEY_REGEX,
  HEXCLAVE_OUTPUT_KEYS,
  HEXCLAVE_SERVICE_ID,
  SERVICE_OUTPUT_KEYS,
  type DeploymentEnvVarDefinition,
  type DeploymentServiceDefinition,
  type HexclaveOutputKey,
} from "@hexclave/shared/dist/deployments";
import path from "node:path";
import { CliError, errorMessage } from "./errors.js";

// Mirrors the backend's userSpecifiedIdSchema so a bad id fails here (with the
// service context) instead of as a 400 from the sync request.
const SERVICE_ID_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;
const SERVICE_ID_MAX_LENGTH = 63;

const SECRET_REF_MARKER = Symbol("hexclave-secret-ref");
const CONNECTION_REF_MARKER = Symbol("hexclave-connection-ref");

type SecretRef = {
  [SECRET_REF_MARKER]: true,
  secretKey: string,
  defaultValue: string | undefined,
};

type ConnectionRef = {
  [CONNECTION_REF_MARKER]: true,
  // `<serviceId>.<outputKey>` or `hexclave.<outputKey>`
  reference: string,
  // Set for `hexclave.*` refs so dev mode can resolve them from the session.
  hexclaveOutputKey: HexclaveOutputKey | undefined,
};

function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === "object" && value !== null && SECRET_REF_MARKER in value;
}

function isConnectionRef(value: unknown): value is ConnectionRef {
  return typeof value === "object" && value !== null && CONNECTION_REF_MARKER in value;
}

/**
 * Makes string coercion of a sentinel throw. Without this,
 * `env: { API: \`${service("db").url}/api\` }` would coerce the ref to
 * "[object Object]" and pass the plain-string env value check — silently
 * deploying garbage. References must be used as whole values.
 */
function preventStringCoercion<T extends object>(sentinel: T, description: string): T {
  const throwOnCoercion = () => {
    throw new CliError(`${description} cannot be embedded in a string. References must be used as the WHOLE env var value (e.g. \`DB_URL: service("db").url\`) — string interpolation with references is not supported, because plain env values must stay entirely literal.`);
  };
  Object.defineProperty(sentinel, Symbol.toPrimitive, { value: throwOnCoercion });
  Object.defineProperty(sentinel, "toString", { value: throwOnCoercion });
  return sentinel;
}

// Property names that runtimes and libraries probe on arbitrary objects
// (promise unwrapping checks "then", console.log checks inspect/toJSON, ...).
// The output proxies must answer those with undefined instead of throwing, or
// perfectly fine user code like `console.log(ctx)` would crash.
const PROBED_PROPERTY_NAMES = new Set(["then", "toJSON", "constructor", "$$typeof", "prototype"]);

/**
 * A proxy whose known output keys resolve via `resolveOutput` and whose
 * unknown STRING property accesses throw a CliError naming the available
 * outputs — a typo like `service("db").ur` should fail at evaluation time with
 * a precise message, not serialize into a broken definition.
 */
function createOutputsProxy(subject: string, outputKeys: readonly string[], resolveOutput: (outputKey: string) => unknown): Record<string, unknown> {
  return new Proxy({}, {
    get: (_target, property) => {
      if (typeof property !== "string" || PROBED_PROPERTY_NAMES.has(property)) {
        return undefined;
      }
      if (!outputKeys.includes(property)) {
        throw new CliError(`${subject} has no output named ${JSON.stringify(property)}. Available outputs: ${outputKeys.join(", ")}.`);
      }
      return resolveOutput(property);
    },
    has: (_target, property) => typeof property === "string" && outputKeys.includes(property),
    ownKeys: () => [...outputKeys],
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property === "string" && outputKeys.includes(property)) {
        return { configurable: true, enumerable: true, value: undefined };
      }
      return undefined;
    },
  });
}

export type ServicesFunctionContext = {
  isDev: boolean,
  secret: (key: string, defaultValue?: string) => unknown,
  service: (serviceId: string) => unknown,
  hexclave: Record<string, unknown>,
};

function createServicesContext(mode: "deploy" | "dev"): { context: ServicesFunctionContext, referencedServiceIds: Set<string> } {
  const referencedServiceIds = new Set<string>();

  const secret = (key: unknown, defaultValue?: unknown): unknown => {
    if (typeof key !== "string" || !DEPLOYMENT_SECRET_KEY_REGEX.test(key)) {
      throw new CliError(`secret() must be called with a secret key containing only letters, numbers, underscores, and hyphens (got ${JSON.stringify(key)}).`);
    }
    if (defaultValue !== undefined && typeof defaultValue !== "string") {
      throw new CliError(`The default value of secret(${JSON.stringify(key)}) must be a string.`);
    }
    // A ref is returned in BOTH modes. Dev mode resolves it to the default
    // value in resolveDevEnv — deliberately deferring the missing-default
    // error to the env of the service actually being run, so a default-less
    // secret in an UNRELATED service can't block `hexclave dev --service-id`
    // for everything else.
    return preventStringCoercion({ [SECRET_REF_MARKER]: true, secretKey: key, defaultValue } satisfies SecretRef, `secret(${JSON.stringify(key)})`);
  };

  const service = (serviceId: unknown): unknown => {
    if (typeof serviceId !== "string" || serviceId.length === 0) {
      throw new CliError(`service() must be called with a service id string (got ${JSON.stringify(serviceId)}).`);
    }
    if (serviceId === HEXCLAVE_SERVICE_ID) {
      throw new CliError(`service(${JSON.stringify(HEXCLAVE_SERVICE_ID)}) does not exist — use the \`hexclave\` context object instead (e.g. \`hexclave.projectId\`).`);
    }
    // Recorded in BOTH modes so a typo'd id fails during `hexclave dev` too,
    // not only at deploy time.
    referencedServiceIds.add(serviceId);
    if (mode === "dev") {
      // During `hexclave dev` there is nothing meaningful to connect to (the
      // referenced service's deployed URL may not even exist), so service()
      // returns null and users are expected to branch on isDev for local
      // values. Accessing an output on the null return crashes evaluation;
      // evaluateServicesFunction wraps that crash with a hint.
      return null;
    }
    return createOutputsProxy(`service(${JSON.stringify(serviceId)})`, SERVICE_OUTPUT_KEYS, (outputKey) => preventStringCoercion({
      [CONNECTION_REF_MARKER]: true,
      reference: `${serviceId}.${outputKey}`,
      hexclaveOutputKey: undefined,
    } satisfies ConnectionRef, `service(${JSON.stringify(serviceId)}).${outputKey}`));
  };

  // hexclave.* returns connection refs in BOTH modes: at deploy time the
  // backend resolves them, and in dev mode the refs are resolved from the
  // development-environment session's env (see resolveDevEnv).
  const hexclave = createOutputsProxy("hexclave", HEXCLAVE_OUTPUT_KEYS, (outputKey) => preventStringCoercion({
    [CONNECTION_REF_MARKER]: true,
    reference: `${HEXCLAVE_SERVICE_ID}.${outputKey}`,
    hexclaveOutputKey: outputKey as HexclaveOutputKey,
  } satisfies ConnectionRef, `hexclave.${outputKey}`));

  return {
    context: { isDev: mode === "dev", secret, service, hexclave },
    referencedServiceIds,
  };
}

// One env var as evaluated, before mode-specific serialization.
type EvaluatedEnvVarValue =
  | { kind: "plain", value: string }
  | { kind: "secret", secretKey: string, defaultValue: string | undefined }
  | { kind: "connection", reference: string, hexclaveOutputKey: HexclaveOutputKey | undefined };

export type EvaluatedService = {
  serviceId: string,
  // The wire-shape definition synced to the backend (deploy mode). In dev
  // mode secrets have already collapsed into plain values and service
  // connections into omissions, so this is still well-formed but only the
  // dev-relevant parts are meaningful.
  definition: DeploymentServiceDefinition,
  env: Record<string, EvaluatedEnvVarValue>,
  absoluteRootDirectory: string,
  devCommand: string | undefined,
  includeFiles: ((relativePath: string) => boolean) | undefined,
  excludeFiles: ((relativePath: string) => boolean) | undefined,
};

export type EvaluatedServices = {
  services: Map<string, EvaluatedService>,
};

const KNOWN_SERVICE_FIELDS = new Set([
  "type", "framework", "installCommand", "buildCommand", "outputDirectory",
  "rootDirectory", "devCommand", "env", "includeFiles", "excludeFiles",
]);

function readOptionalStringField(record: Record<string, unknown>, serviceId: string, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CliError(`services.${serviceId}.${field} must be a string.`);
  }
  return value;
}

function readOptionalFunctionField(record: Record<string, unknown>, serviceId: string, field: string): ((relativePath: string) => boolean) | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "function") {
    throw new CliError(`services.${serviceId}.${field} must be a function of (relativePath: string) => boolean.`);
  }
  // The user's predicate can return anything (coerced to a boolean) and can
  // throw; both are wrapped here so a buggy predicate surfaces as a clean
  // error naming the service and field instead of a raw stack dump from deep
  // inside the packaging walk.
  return (relativePath: string) => {
    try {
      return Boolean((value as (p: string) => unknown)(relativePath));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`services.${serviceId}.${field} threw while filtering ${JSON.stringify(relativePath)}: ${errorMessage(error)}`);
    }
  };
}

function evaluateEnvRecord(serviceId: string, envRaw: unknown): Record<string, EvaluatedEnvVarValue> {
  if (envRaw === undefined) return {};
  if (envRaw === null || typeof envRaw !== "object" || Array.isArray(envRaw)) {
    throw new CliError(`services.${serviceId}.env must be a record of env var values.`);
  }
  const env: Record<string, EvaluatedEnvVarValue> = {};
  for (const [envVarKey, value] of Object.entries(envRaw as Record<string, unknown>)) {
    if (!DEPLOYMENT_ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new CliError(`services.${serviceId}.env has an invalid key ${JSON.stringify(envVarKey)}. Env var keys must start with a letter or underscore and contain only letters, digits, and underscores.`);
    }
    if (value === null || value === undefined) {
      // null means "omit this env var" — the isDev-branching idiom
      // (`isDev ? null : secret(...)`) depends on it.
      continue;
    }
    if (typeof value === "string") {
      env[envVarKey] = { kind: "plain", value };
    } else if (isSecretRef(value)) {
      env[envVarKey] = { kind: "secret", secretKey: value.secretKey, defaultValue: value.defaultValue };
    } else if (isConnectionRef(value)) {
      env[envVarKey] = { kind: "connection", reference: value.reference, hexclaveOutputKey: value.hexclaveOutputKey };
    } else if (typeof value === "object" && (SERVICE_OUTPUT_KEYS as readonly string[]).some((outputKey) => outputKey in (value as object))) {
      // The whole outputs object was assigned instead of one of its outputs.
      throw new CliError(`services.${serviceId}.env.${envVarKey} is a service returned by service() — pick one of its outputs instead (e.g. service("...").url).`);
    } else {
      throw new CliError(`services.${serviceId}.env.${envVarKey} must be a string, null, secret(...), service(...).<output>, or hexclave.<output> (got ${typeof value}).`);
    }
  }
  return env;
}

function serializeEnvForWire(env: Record<string, EvaluatedEnvVarValue>): Record<string, DeploymentEnvVarDefinition> {
  return Object.fromEntries(Object.entries(env).map(([envVarKey, value]): [string, DeploymentEnvVarDefinition] => {
    switch (value.kind) {
      case "plain": {
        return [envVarKey, { value: value.value }];
      }
      case "secret": {
        return [envVarKey, { type: "secret", key: value.secretKey, ...value.defaultValue !== undefined ? { default_value: value.defaultValue } : {} }];
      }
      case "connection": {
        return [envVarKey, { type: "connection", value: value.reference }];
      }
    }
  }));
}

/**
 * Evaluates a loaded config module's `services` export. `configPath` must be
 * the absolute path of the config file (root directories resolve relative to
 * its directory).
 */
export function evaluateServicesFunction(options: {
  configPath: string,
  servicesExport: unknown,
  mode: "deploy" | "dev",
}): EvaluatedServices {
  const { configPath, servicesExport, mode } = options;
  const configDirectory = path.dirname(configPath);

  if (servicesExport === undefined) {
    throw new CliError(`The config file ${configPath} has no \`services\` export. Add one, e.g.:\n  export const services = ({ isDev, secret, service, hexclave }) => ({\n    web: {\n      type: "vercel",\n      framework: "next",\n      devCommand: "npm run dev",\n      env: { HEXCLAVE_PROJECT_ID: hexclave.projectId },\n    },\n  });`);
  }
  if (typeof servicesExport !== "function") {
    throw new CliError(`The \`services\` export of ${configPath} must be a function of ({ isDev, secret, service, hexclave }) returning the service record — not a plain object. Wrap it in a function: \`export const services = () => ({ ... })\`.`);
  }

  const { context, referencedServiceIds } = createServicesContext(mode);
  let servicesRaw: unknown;
  try {
    servicesRaw = (servicesExport as (ctx: ServicesFunctionContext) => unknown)(context);
  } catch (error) {
    if (error instanceof CliError) throw error;
    // The most common dev-mode crash: accessing `.url` on service()'s null
    // return without an isDev guard. Attach the explanation to the TypeError
    // instead of letting a bare "Cannot read properties of null" surface.
    if (mode === "dev" && error instanceof TypeError && /null/.test(error.message)) {
      throw new CliError(`Failed to evaluate the services export of ${configPath}: ${error.message}\nNote: during \`hexclave dev\`, service() returns null — guard connection values with isDev, e.g. \`isDev ? "http://localhost:5432" : service("database").url\`.`);
    }
    throw new CliError(`Failed to evaluate the services export of ${configPath}: ${errorMessage(error)}`);
  }
  // An async function's Promise would pass the plain-object check below with
  // zero enumerable entries and die on the misleading "returned no services".
  if (servicesRaw !== null && typeof servicesRaw === "object" && "then" in servicesRaw && typeof (servicesRaw as { then: unknown }).then === "function") {
    throw new CliError(`The services function of ${configPath} must be synchronous, but it returned a Promise. Remove the \`async\` keyword — secrets and connections are resolved for you, nothing in the services export needs to be awaited.`);
  }
  if (servicesRaw === null || typeof servicesRaw !== "object" || Array.isArray(servicesRaw)) {
    throw new CliError(`The services function of ${configPath} must return a record of services keyed by service id.`);
  }

  const services = new Map<string, EvaluatedService>();
  for (const [serviceId, serviceRaw] of Object.entries(servicesRaw as Record<string, unknown>)) {
    if (!SERVICE_ID_PATTERN.test(serviceId) || serviceId.length > SERVICE_ID_MAX_LENGTH) {
      throw new CliError(`Invalid service id ${JSON.stringify(serviceId)}. Service ids must be at most ${SERVICE_ID_MAX_LENGTH} characters and contain only letters, numbers, underscores, and hyphens (not starting with a hyphen).`);
    }
    if (serviceId === HEXCLAVE_SERVICE_ID) {
      throw new CliError(`The service id ${JSON.stringify(HEXCLAVE_SERVICE_ID)} is reserved for the managed Hexclave service.`);
    }
    if (serviceRaw === null || typeof serviceRaw !== "object" || Array.isArray(serviceRaw)) {
      throw new CliError(`services.${serviceId} must be an object.`);
    }
    const record = serviceRaw as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!KNOWN_SERVICE_FIELDS.has(field)) {
        throw new CliError(`services.${serviceId} has an unknown field ${JSON.stringify(field)}. Known fields: ${[...KNOWN_SERVICE_FIELDS].join(", ")}.`);
      }
    }
    if (record.type !== "vercel") {
      throw new CliError(record.type === undefined
        ? `services.${serviceId} has no \`type\`. Add \`type: "vercel"\`.`
        : `services.${serviceId}.type must be "vercel" (got ${JSON.stringify(record.type)}).`);
    }

    const rootDirectoryRaw = readOptionalStringField(record, serviceId, "rootDirectory");
    const absoluteRootDirectory = path.resolve(configDirectory, rootDirectoryRaw ?? ".");
    const relativeRootDirectory = path.relative(configDirectory, absoluteRootDirectory);
    if (relativeRootDirectory === ".." || relativeRootDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRootDirectory)) {
      throw new CliError(`services.${serviceId}.rootDirectory resolves to ${absoluteRootDirectory}, which is outside the directory containing the config file (${configDirectory}). Root directories must be inside it.`);
    }

    const env = evaluateEnvRecord(serviceId, record.env);
    const devCommand = readOptionalStringField(record, serviceId, "devCommand");
    services.set(serviceId, {
      serviceId,
      definition: {
        type: "vercel",
        framework: readOptionalStringField(record, serviceId, "framework"),
        install_command: readOptionalStringField(record, serviceId, "installCommand"),
        build_command: readOptionalStringField(record, serviceId, "buildCommand"),
        output_directory: readOptionalStringField(record, serviceId, "outputDirectory"),
        // Stored/displayed as a config-directory-relative posix path ("." for
        // the config directory itself) — an absolute local path would be
        // meaningless (and leak local filesystem layout) server-side.
        root_directory: relativeRootDirectory === "" ? "." : relativeRootDirectory.split(path.sep).join("/"),
        dev_command: devCommand,
        env: serializeEnvForWire(env),
      },
      env,
      absoluteRootDirectory,
      devCommand,
      includeFiles: readOptionalFunctionField(record, serviceId, "includeFiles"),
      excludeFiles: readOptionalFunctionField(record, serviceId, "excludeFiles"),
    });
  }

  if (services.size === 0) {
    throw new CliError(`The services function of ${configPath} returned no services.`);
  }

  // Every service("...") call must reference a defined service — a typo'd id
  // would otherwise only fail server-side at deploy time.
  for (const referencedServiceId of referencedServiceIds) {
    if (!services.has(referencedServiceId)) {
      throw new CliError(`service(${JSON.stringify(referencedServiceId)}) does not match any defined service. Available services: ${[...services.keys()].join(", ")}.`);
    }
  }
  // Self-references can never be satisfied (a service's first deploy cannot
  // read its own deployment output). Mirrors the backend check, but fails
  // before anything is uploaded.
  for (const [serviceId, service] of services) {
    for (const [envVarKey, value] of Object.entries(service.env)) {
      if (value.kind === "connection" && value.reference.split(".")[0] === serviceId) {
        throw new CliError(`services.${serviceId}.env.${envVarKey} connects to the service's own output "${value.reference}". A service cannot reference itself.`);
      }
    }
  }

  return { services };
}

/**
 * Orders services into deployment levels: every service deploys after all
 * services it connects to (its env references their deployment outputs), and
 * services within one level are independent of each other. Throws on circular
 * dependencies, naming the cycle.
 */
export function computeDeploymentLevels(services: Map<string, EvaluatedService>): string[][] {
  const dependencies = new Map<string, Set<string>>();
  for (const [serviceId, service] of services) {
    const serviceDependencies = new Set<string>();
    for (const value of Object.values(service.env)) {
      if (value.kind !== "connection") continue;
      const targetServiceId = value.reference.split(".")[0];
      // hexclave.* outputs come from the managed service, which always exists;
      // connections to services OUTSIDE this config (possible when deploying a
      // subset in the future) are resolved against already-deployed state.
      if (targetServiceId !== HEXCLAVE_SERVICE_ID && services.has(targetServiceId)) {
        serviceDependencies.add(targetServiceId);
      }
    }
    dependencies.set(serviceId, serviceDependencies);
  }

  const levels: string[][] = [];
  const placed = new Set<string>();
  while (placed.size < services.size) {
    const level = [...services.keys()].filter((serviceId) =>
      !placed.has(serviceId)
      && [...(dependencies.get(serviceId) ?? [])].every((dependency) => placed.has(dependency)));
    if (level.length === 0) {
      // Everything unplaced is part of (or downstream of) a cycle; walk one
      // cycle explicitly so the error names it.
      const unplaced = [...services.keys()].filter((serviceId) => !placed.has(serviceId));
      const cycle = findDependencyCycle(unplaced, dependencies) ?? unplaced;
      throw new CliError(`The services have a circular connection dependency: ${[...cycle, cycle[0]].join(" -> ")}. Break the cycle (e.g. move one of the URLs into a plain env var).`);
    }
    for (const serviceId of level) placed.add(serviceId);
    levels.push(level);
  }
  return levels;
}

function findDependencyCycle(serviceIds: string[], dependencies: Map<string, Set<string>>): string[] | undefined {
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (serviceId: string): string[] | undefined => {
    const cycleStart = visiting.indexOf(serviceId);
    if (cycleStart !== -1) {
      return visiting.slice(cycleStart);
    }
    if (visited.has(serviceId)) return undefined;
    visiting.push(serviceId);
    for (const dependency of dependencies.get(serviceId) ?? []) {
      const cycle = visit(dependency);
      if (cycle !== undefined) return cycle;
    }
    visiting.pop();
    visited.add(serviceId);
    return undefined;
  };
  for (const serviceId of serviceIds) {
    const cycle = visit(serviceId);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

/**
 * Resolves a dev-mode evaluated env record into literal values using the
 * development-environment session's env (which carries the project's
 * credentials). Called by `hexclave dev` after the session exists.
 */
export function resolveDevEnv(service: EvaluatedService, sessionEnv: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [envVarKey, value] of Object.entries(service.env)) {
    switch (value.kind) {
      case "plain": {
        resolved[envVarKey] = value.value;
        break;
      }
      case "secret": {
        // Secrets are never fetched from the dashboard during dev; the
        // default is all there is. The error fires here (per selected
        // service) rather than at evaluation time, so it only triggers for
        // the service actually being run.
        if (value.defaultValue === undefined) {
          throw new CliError(`The secret ${JSON.stringify(value.secretKey)} (env var ${JSON.stringify(envVarKey)}) has no default value, so it cannot be resolved during \`hexclave dev\`. Add a default (secret(${JSON.stringify(value.secretKey)}, "some-dev-value")) or guard it with isDev (e.g. \`isDev ? null : secret(${JSON.stringify(value.secretKey)})\`).`);
        }
        resolved[envVarKey] = value.defaultValue;
        break;
      }
      case "connection": {
        if (value.hexclaveOutputKey === undefined) {
          // Unreachable: in dev mode, service() returns null, so non-hexclave
          // connection refs cannot be constructed.
          throw new CliError(`Internal error: env var ${JSON.stringify(envVarKey)} is an unresolved service connection in dev mode.`);
        }
        resolved[envVarKey] = resolveHexclaveOutputFromSessionEnv(envVarKey, value.hexclaveOutputKey, sessionEnv);
        break;
      }
    }
  }
  return resolved;
}

function resolveHexclaveOutputFromSessionEnv(envVarKey: string, outputKey: HexclaveOutputKey, sessionEnv: Record<string, string>): string {
  const fromSession = (name: string): string => sessionEnv[name] ?? (() => {
    throw new CliError(`Cannot resolve hexclave.${outputKey} for env var ${JSON.stringify(envVarKey)}: the development-environment session did not provide ${name}.`);
  })();
  switch (outputKey) {
    case "projectId": {
      return fromSession("HEXCLAVE_PROJECT_ID");
    }
    case "apiUrl": {
      return fromSession("HEXCLAVE_API_URL");
    }
    case "jwksUrl": {
      const apiUrl = fromSession("HEXCLAVE_API_URL");
      const projectId = fromSession("HEXCLAVE_PROJECT_ID");
      return `${apiUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/.well-known/jwks.json`;
    }
    case "publishableClientKey": {
      return fromSession("HEXCLAVE_PUBLISHABLE_CLIENT_KEY");
    }
    case "secretServerKey": {
      return fromSession("HEXCLAVE_SECRET_SERVER_KEY");
    }
  }
}

/**
 * Loads a config file via jiti and returns its exports. Shared by deploy and
 * dev so both fail with the same error on an unloadable config file.
 */
export async function importConfigModule(configPath: string): Promise<{ config: unknown, services: unknown }> {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  let configModule: { config?: unknown, services?: unknown };
  try {
    configModule = await jiti.import(configPath);
  } catch (error: unknown) {
    throw new CliError(`Failed to load config file ${configPath}: ${errorMessage(error)}`);
  }
  return { config: configModule.config, services: configModule.services };
}
