// Evaluates the `deployment` export of hexclave.config.ts.
//
// The export is an object with a `services` member. `services` is normally a
// FUNCTION, so it can reach secrets, connections, and the managed backend's
// outputs; a plain record is accepted when a config needs none of them.
//
//   export const deployment: HexclaveDeploymentConfig = {
//     services: ({ isDev, secret, service, hexclave }) => ({
//       frontend: {
//         type: "serverless",
//         ports: [{ port: 3000, public: true }],
//         maxInstances: 3,
//         devCommand: "pnpm dev",
//         env: {
//           DB_URL: service("database").internalUrl,
//           OPENAI: isDev ? null : secret("OPENAI_API_KEY", "some-default"),
//           PROJECT_ID: hexclave.projectId,
//         },
//       },
//       database: {
//         type: "server",
//         ports: [{ port: 5432, transport: "tcp" }],
//         persistentVolumes: { pgdata: { path: "/var/lib/postgresql/data", sizeGb: 10 } },
//       },
//     }),
//   };
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
  DEPLOYMENT_SERVICE_TYPES,
  DEPLOYMENT_VOLUME_ID_REGEX,
  HEXCLAVE_OUTPUT_KEYS,
  HEXCLAVE_SERVICE_ID,
  MAX_PERSISTENT_VOLUMES_PER_SERVICE,
  MAX_PORTS_PER_SERVICE,
  MAX_VOLUME_ID_LENGTH,
  MAX_VOLUME_SIZE_GB,
  MIN_VOLUME_SIZE_GB,
  SERVICE_OUTPUT_KEYS,
  deploymentServiceIsPublic,
  portTransport,
  soleDeploymentPort,
  soleHttpDeploymentPort,
  type DeploymentEnvVarDefinition,
  type DeploymentPortDefinition,
  type DeploymentServiceDefinition,
  type DeploymentServiceType,
  type DeploymentVolumeDefinition,
  type HexclaveOutputKey,
} from "@hexclave/shared/dist/deployments";
import { PROJECT_SECRET_KEY_REGEX } from "@hexclave/shared/dist/project-secrets";
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
    if (typeof key !== "string" || !PROJECT_SECRET_KEY_REGEX.test(key)) {
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
      // evaluateDeploymentConfig wraps that crash with a hint.
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
  // Local-only: `hexclave dev --service-id` runs this. It is deliberately
  // absent from `definition` (and from the sync route's schema) because the
  // backend never acts on it, so there is no reason for it to leave the
  // machine or to be stored where it could drift from the config file.
  devCommand: string | undefined,
};

export type EvaluatedServices = {
  services: Map<string, EvaluatedService>,
};

const KNOWN_SERVICE_FIELDS = new Set([
  "type", "ports", "minInstances", "maxInstances",
  "rootDirectory", "dockerfilePath", "devCommand", "persistentVolumes", "env",
]);
const KNOWN_VOLUME_FIELDS = new Set(["path", "sizeGb"]);

function readOptionalIntegerField(record: Record<string, unknown>, serviceId: string, field: string): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CliError(`deployment.services.${serviceId}.${field} must be an integer.`);
  }
  return value;
}

function readOptionalStringField(record: Record<string, unknown>, serviceId: string, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CliError(`deployment.services.${serviceId}.${field} must be a string.`);
  }
  return value;
}

/**
 * Evaluates the optional `persistentVolumes: { <id>: { path, sizeGb } }` field.
 * Author-facing `sizeGb` becomes `size_gb` on the wire; the mount path must be
 * absolute and normalized so it is unambiguous against the image's WORKDIR.
 *
 * The KEY is the volume's id: Marshal names the Fly volume from it, inside the
 * service's own Fly app. It therefore identifies the disk within a service —
 * the same id under a different service is a DIFFERENT (empty) disk.
 */
const KNOWN_PORT_FIELDS = new Set(["port", "public", "transport"]);

/**
 * Evaluates the `ports` array. There is no service-level visibility: a service
 * is public exactly when one of its ports is, so the only thing to reconcile
 * here is the port list itself.
 */
function evaluatePorts(serviceId: string, portsRaw: unknown): DeploymentPortDefinition[] {
  if (portsRaw === undefined || portsRaw === null) {
    throw new CliError(`deployment.services.${serviceId} has no \`ports\`. Every service must declare the ports its container listens on, e.g. \`ports: [{ port: 3000, public: true }]\`.`);
  }
  if (!Array.isArray(portsRaw)) {
    throw new CliError(`deployment.services.${serviceId}.ports must be an array, e.g. \`ports: [{ port: 3000, public: true }]\` (got ${JSON.stringify(typeof portsRaw)}).`);
  }
  if (portsRaw.length === 0) {
    throw new CliError(`deployment.services.${serviceId}.ports is empty. A service is only ready once a declared port accepts connections, so it must declare at least one.`);
  }
  if (portsRaw.length > MAX_PORTS_PER_SERVICE) {
    throw new CliError(`deployment.services.${serviceId}.ports declares ${portsRaw.length} ports, but at most ${MAX_PORTS_PER_SERVICE} per service is supported.`);
  }

  const ports: DeploymentPortDefinition[] = [];
  const seenPorts = new Set<number>();
  for (const [index, portRaw] of portsRaw.entries()) {
    const at = `deployment.services.${serviceId}.ports[${index}]`;
    if (portRaw === null || typeof portRaw !== "object" || Array.isArray(portRaw)) {
      throw new CliError(`${at} must be an object, e.g. \`{ port: 3000, public: true }\`.`);
    }
    const record = portRaw as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!KNOWN_PORT_FIELDS.has(field)) {
        throw new CliError(`${at} has an unknown field ${JSON.stringify(field)}. Known fields: ${[...KNOWN_PORT_FIELDS].join(", ")}.`);
      }
    }

    const port = record.port;
    if (typeof port !== "number" || !Number.isInteger(port)) {
      throw new CliError(`${at}.port is required and must be an integer, e.g. \`{ port: 3000 }\`.`);
    }
    if (port < 1 || port > 65535) {
      throw new CliError(`${at}.port must be between 1 and 65535 (got ${port}).`);
    }
    if (seenPorts.has(port)) {
      throw new CliError(`${at} declares port ${port}, which is already declared on deployment.services.${serviceId}. Each port may only appear once.`);
    }
    seenPorts.add(port);

    if (record.public !== undefined && typeof record.public !== "boolean") {
      throw new CliError(`${at}.public must be true or false (got ${JSON.stringify(record.public)}). It defaults to false — ports are private unless you say otherwise.`);
    }
    const isPublic = record.public === true;

    const transport = record.transport ?? "http";
    if (transport !== "http" && transport !== "tcp") {
      throw new CliError(`${at}.transport must be "http" or "tcp" (got ${JSON.stringify(record.transport)}).`);
    }
    if (transport === "tcp" && isPublic) {
      throw new CliError(`${at} is a "tcp" port, which is private-only: raw TCP gets no TLS termination and no HTTP routing, so it cannot be served on a public hostname. Drop \`public: true\` and connect with service(${JSON.stringify(serviceId)}).internalHost and port ${port}.`);
    }

    ports.push({ port, public: isPublic, transport });
  }

  // 80 and 443 reach exactly one port, so a second public port has nowhere to
  // be served from.
  const publicPorts = ports.filter((entry) => entry.public);
  if (publicPorts.length > 1) {
    throw new CliError(`deployment.services.${serviceId} marks ${publicPorts.length} ports public (${publicPorts.map((entry) => entry.port).join(", ")}), but a service may only expose one. Its platform URL and any custom domain serve a single port on 80/443 — keep one public and reach the rest privately with service(${JSON.stringify(serviceId)}).internalHost.`);
  }
  return ports;
}

function evaluatePersistentVolumes(serviceId: string, volumesRaw: unknown): Record<string, DeploymentVolumeDefinition> | undefined {
  if (volumesRaw === undefined || volumesRaw === null) return undefined;
  if (typeof volumesRaw !== "object" || Array.isArray(volumesRaw)) {
    throw new CliError(`deployment.services.${serviceId}.persistentVolumes must be an object keyed by volume id, e.g. \`persistentVolumes: { data: { path: "/data", sizeGb: 10 } }\`.`);
  }
  const volumesRecord = volumesRaw as Record<string, unknown>;
  const volumeIds = Object.keys(volumesRecord);
  if (volumeIds.length === 0) return undefined;
  // Fly mounts at most one volume per machine, so a second entry could not be
  // honoured. Refuse it outright rather than silently mounting the first.
  if (volumeIds.length > MAX_PERSISTENT_VOLUMES_PER_SERVICE) {
    throw new CliError(`deployment.services.${serviceId}.persistentVolumes declares ${volumeIds.length} volumes (${volumeIds.join(", ")}), but only ${MAX_PERSISTENT_VOLUMES_PER_SERVICE} per service is supported right now. Keep one volume and put the rest on separate services.`);
  }

  const volumes = new Map<string, DeploymentVolumeDefinition>();
  for (const [volumeId, volumeRaw] of Object.entries(volumesRecord)) {
    // The id becomes the Fly volume name, which is alphanumeric + underscore.
    if (!DEPLOYMENT_VOLUME_ID_REGEX.test(volumeId) || volumeId.length > MAX_VOLUME_ID_LENGTH) {
      throw new CliError(`Invalid persistent volume id ${JSON.stringify(volumeId)} on deployment.services.${serviceId}. Volume ids must start with a lowercase letter, contain only lowercase letters, digits, and underscores, and be at most ${MAX_VOLUME_ID_LENGTH} characters.`);
    }
    if (volumeRaw === null || typeof volumeRaw !== "object" || Array.isArray(volumeRaw)) {
      throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId} must be an object, e.g. \`{ path: "/data", sizeGb: 10 }\`.`);
    }
    const record = volumeRaw as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!KNOWN_VOLUME_FIELDS.has(field)) {
        throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId} has an unknown field ${JSON.stringify(field)}. Known fields: ${[...KNOWN_VOLUME_FIELDS].join(", ")}.`);
      }
    }

    const volumePath = record.path;
    if (typeof volumePath !== "string" || volumePath === "") {
      throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId}.path is required and must be the absolute path the disk is mounted at inside the container, e.g. "/data".`);
    }
    if (volumePath.length > 512
      || !volumePath.startsWith("/")
      || volumePath === "/"
      || volumePath.endsWith("/")
      || volumePath.includes("\\")
      // eslint-disable-next-line no-control-regex
      || /[\x00-\x1f]/.test(volumePath)
      || volumePath.split("/").slice(1).some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId}.path must be a normalized absolute path inside the container (got ${JSON.stringify(volumePath)}). Use something like "/data" — no trailing slash, no "." or ".." segments.`);
    }

    const sizeGb = record.sizeGb;
    if (typeof sizeGb !== "number" || !Number.isInteger(sizeGb)) {
      throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId}.sizeGb is required and must be a whole number of gigabytes, e.g. \`sizeGb: 10\`.`);
    }
    if (sizeGb < MIN_VOLUME_SIZE_GB || sizeGb > MAX_VOLUME_SIZE_GB) {
      throw new CliError(`deployment.services.${serviceId}.persistentVolumes.${volumeId}.sizeGb must be between ${MIN_VOLUME_SIZE_GB} and ${MAX_VOLUME_SIZE_GB} GB (got ${sizeGb}).`);
    }
    volumes.set(volumeId, { path: volumePath, size_gb: sizeGb });
  }
  return Object.fromEntries(volumes);
}

function evaluateEnvRecord(serviceId: string, envRaw: unknown): Record<string, EvaluatedEnvVarValue> {
  if (envRaw === undefined) return {};
  if (envRaw === null || typeof envRaw !== "object" || Array.isArray(envRaw)) {
    throw new CliError(`deployment.services.${serviceId}.env must be a record of env var values.`);
  }
  const env = new Map<string, EvaluatedEnvVarValue>();
  for (const [envVarKey, value] of Object.entries(envRaw as Record<string, unknown>)) {
    if (!DEPLOYMENT_ENV_VAR_KEY_REGEX.test(envVarKey)) {
      throw new CliError(`deployment.services.${serviceId}.env has an invalid key ${JSON.stringify(envVarKey)}. Env var keys must start with a letter or underscore and contain only letters, digits, and underscores.`);
    }
    if (value === null || value === undefined) {
      // null means "omit this env var" — the isDev-branching idiom
      // (`isDev ? null : secret(...)`) depends on it.
      continue;
    }
    if (typeof value === "string") {
      env.set(envVarKey, { kind: "plain", value });
    } else if (isSecretRef(value)) {
      env.set(envVarKey, { kind: "secret", secretKey: value.secretKey, defaultValue: value.defaultValue });
    } else if (isConnectionRef(value)) {
      env.set(envVarKey, { kind: "connection", reference: value.reference, hexclaveOutputKey: value.hexclaveOutputKey });
    } else if (typeof value === "object" && (SERVICE_OUTPUT_KEYS as readonly string[]).some((outputKey) => outputKey in (value as object))) {
      // The whole outputs object was assigned instead of one of its outputs.
      throw new CliError(`deployment.services.${serviceId}.env.${envVarKey} is a service returned by service() — pick one of its outputs instead (e.g. service("...").url).`);
    } else {
      throw new CliError(`deployment.services.${serviceId}.env.${envVarKey} must be a string, null, secret(...), service(...).<output>, or hexclave.<output> (got ${typeof value}).`);
    }
  }
  return Object.fromEntries(env);
}

function serializeEnvForWire(env: Record<string, EvaluatedEnvVarValue>): Record<string, DeploymentEnvVarDefinition> {
  return Object.fromEntries(Object.entries(env).map(([envVarKey, value]): [string, DeploymentEnvVarDefinition] => {
    switch (value.kind) {
      case "plain": {
        return [envVarKey, { value: value.value }];
      }
      case "secret": {
        // No default_value: defaults are author-side only and never persisted
        // server-side. They travel with the deploy request instead — see
        // collectSecretDefaults.
        return [envVarKey, { type: "secret", key: value.secretKey }];
      }
      case "connection": {
        return [envVarKey, { type: "connection", value: value.reference }];
      }
    }
  }));
}

const EXAMPLE_DEPLOYMENT_EXPORT = `  export const deployment: HexclaveDeploymentConfig = {
    services: ({ isDev, secret, service, hexclave }) => ({
      web: {
        type: "serverless",
        port: 3000,
        devCommand: "npm run dev",
        env: { HEXCLAVE_PROJECT_ID: hexclave.projectId },
      },
    }),
  };`;

/**
 * Evaluates a loaded config module's `deployment` export. `configPath` must be
 * the absolute path of the config file (root directories resolve relative to
 * its directory).
 */
export function evaluateDeploymentConfig(options: {
  configPath: string,
  deploymentExport: unknown,
  mode: "deploy" | "dev",
}): EvaluatedServices {
  const { configPath, deploymentExport, mode } = options;
  const configDirectory = path.dirname(configPath);

  if (deploymentExport === undefined) {
    throw new CliError(`The config file ${configPath} has no \`deployment\` export. Add one, e.g.:\n${EXAMPLE_DEPLOYMENT_EXPORT}`);
  }
  // The context function belongs on `services`, not on `deployment` itself —
  // an easy slip, and the resulting shape error is otherwise opaque.
  if (typeof deploymentExport === "function") {
    throw new CliError(`The \`deployment\` export of ${configPath} must be an object with a \`services\` member, not a function. The context function goes on \`services\`: \`export const deployment = { services: ({ ... }) => ({ ... }) };\``);
  }
  if (deploymentExport === null || typeof deploymentExport !== "object" || Array.isArray(deploymentExport)) {
    throw new CliError(`The \`deployment\` export of ${configPath} must be an object, e.g.:\n${EXAMPLE_DEPLOYMENT_EXPORT}`);
  }
  const deploymentRecord = deploymentExport as Record<string, unknown>;
  for (const field of Object.keys(deploymentRecord)) {
    if (field !== "services") {
      throw new CliError(`The \`deployment\` export of ${configPath} has an unknown field ${JSON.stringify(field)}. The only supported field is \`services\`.`);
    }
  }
  const servicesExport = deploymentRecord.services;
  if (servicesExport === undefined) {
    throw new CliError(`The \`deployment\` export of ${configPath} has no \`services\`. Add one, e.g.:\n${EXAMPLE_DEPLOYMENT_EXPORT}`);
  }

  const { context, referencedServiceIds } = createServicesContext(mode);
  let servicesRaw: unknown;
  if (typeof servicesExport === "function") {
    try {
      servicesRaw = (servicesExport as (ctx: ServicesFunctionContext) => unknown)(context);
    } catch (error) {
      if (error instanceof CliError) throw error;
      // The most common dev-mode crash: accessing `.url` on service()'s null
      // return without an isDev guard. Attach the explanation to the TypeError
      // instead of letting a bare "Cannot read properties of null" surface.
      if (mode === "dev" && error instanceof TypeError && /null/.test(error.message)) {
        throw new CliError(`Failed to evaluate deployment.services of ${configPath}: ${error.message}\nNote: during \`hexclave dev\`, service() returns null — guard connection values with isDev, e.g. \`isDev ? "http://localhost:5432" : service("database").url\`.`);
      }
      throw new CliError(`Failed to evaluate deployment.services of ${configPath}: ${errorMessage(error)}`);
    }
  } else {
    // A plain record is allowed for configs that reference no secrets,
    // connections, or managed outputs — there is nothing for the context to
    // supply, so requiring a function would be ceremony for its own sake.
    servicesRaw = servicesExport;
  }
  // An async function's Promise would pass the plain-object check below with
  // zero enumerable entries and die on the misleading "returned no services".
  if (servicesRaw !== null && typeof servicesRaw === "object" && "then" in servicesRaw && typeof (servicesRaw as { then: unknown }).then === "function") {
    throw new CliError(`deployment.services of ${configPath} must be synchronous, but it returned a Promise. Remove the \`async\` keyword — secrets and connections are resolved for you, nothing in the services export needs to be awaited.`);
  }
  if (servicesRaw === null || typeof servicesRaw !== "object" || Array.isArray(servicesRaw)) {
    throw new CliError(`deployment.services of ${configPath} must be a record of services keyed by service id (or a function returning one).`);
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
      throw new CliError(`deployment.services.${serviceId} must be an object.`);
    }
    const record = serviceRaw as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!KNOWN_SERVICE_FIELDS.has(field)) {
        throw new CliError(`deployment.services.${serviceId} has an unknown field ${JSON.stringify(field)}. Known fields: ${[...KNOWN_SERVICE_FIELDS].join(", ")}.`);
      }
    }
    if (!(DEPLOYMENT_SERVICE_TYPES as readonly unknown[]).includes(record.type)) {
      throw new CliError(record.type === undefined
        ? `deployment.services.${serviceId} has no \`type\`. Add \`type: "server"\` (single suspending instance, may have persistentVolumes) or \`type: "serverless"\` (scales out, stops on scale-down).`
        : `deployment.services.${serviceId}.type must be ${DEPLOYMENT_SERVICE_TYPES.map((knownType: string) => JSON.stringify(knownType)).join(" or ")} (got ${JSON.stringify(record.type)}).`);
    }
    const serviceType = record.type as DeploymentServiceType;
    const ports = evaluatePorts(serviceId, record.ports);

    const rootDirectoryRaw = readOptionalStringField(record, serviceId, "rootDirectory");
    const absoluteRootDirectory = path.resolve(configDirectory, rootDirectoryRaw ?? ".");
    const relativeRootDirectory = path.relative(configDirectory, absoluteRootDirectory);
    if (relativeRootDirectory === ".." || relativeRootDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRootDirectory)) {
      throw new CliError(`deployment.services.${serviceId}.rootDirectory resolves to ${absoluteRootDirectory}, which is outside the directory containing the config file (${configDirectory}). Root directories must be inside it.`);
    }

    // Optional Dockerfile location, relative to the root directory. When it is
    // absent, the service is NOT built from a Dockerfile at all — the remote
    // builder auto-detects the build with Railpack (https://railpack.com)
    // instead, even if a file named "Dockerfile" happens to exist.
    const dockerfilePathRaw = readOptionalStringField(record, serviceId, "dockerfilePath");
    let dockerfilePath: string | undefined;
    if (dockerfilePathRaw !== undefined) {
      const absoluteDockerfilePath = path.resolve(absoluteRootDirectory, dockerfilePathRaw);
      const relativeDockerfilePath = path.relative(absoluteRootDirectory, absoluteDockerfilePath);
      if (relativeDockerfilePath === "" || relativeDockerfilePath === ".." || relativeDockerfilePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDockerfilePath)) {
        throw new CliError(`deployment.services.${serviceId}.dockerfilePath must point to a file inside the service's root directory (got ${JSON.stringify(dockerfilePathRaw)}).`);
      }
      dockerfilePath = relativeDockerfilePath.split(path.sep).join("/");
    }

    const minInstances = readOptionalIntegerField(record, serviceId, "minInstances");
    const maxInstances = readOptionalIntegerField(record, serviceId, "maxInstances");
    if (minInstances !== undefined && (minInstances < 0 || minInstances > 5)) {
      throw new CliError(`deployment.services.${serviceId}.minInstances must be between 0 and 5.`);
    }
    if (maxInstances !== undefined && (maxInstances < 1 || maxInstances > 5)) {
      throw new CliError(`deployment.services.${serviceId}.maxInstances must be between 1 and 5.`);
    }
    // Only reject when max is explicitly below min. min-only is fine: max defaults up to min
    // downstream, so the spec stays consistent (this used to slip through and 400 from the runtime).
    if (minInstances !== undefined && maxInstances !== undefined && maxInstances < minInstances) {
      throw new CliError(`deployment.services.${serviceId}.maxInstances (${maxInstances}) must be at least minInstances (${minInstances}).`);
    }
    // A "server" is exactly one instance that suspends when idle, so scaling
    // bounds may only ever restate that. Anything else is a type mismatch, not
    // a bounds error, so point at the type the author probably wanted.
    if (serviceType === "server") {
      if (maxInstances !== undefined && maxInstances !== 1) {
        throw new CliError(`deployment.services.${serviceId} is a "server", which is always a single instance, so maxInstances must be 1 (got ${maxInstances}). Use \`type: "serverless"\` to scale out.`);
      }
      if (minInstances !== undefined && minInstances !== 0) {
        throw new CliError(`deployment.services.${serviceId} is a "server", which scales to zero by suspending, so minInstances must be 0 (got ${minInstances}). Use \`type: "serverless"\` with \`minInstances: ${minInstances}\` for always-on instances.`);
      }
    }

    // A volume is local disk on a single host and attaches to at most one
    // instance, so only a "server" can hold one.
    const persistentVolumes = evaluatePersistentVolumes(serviceId, record.persistentVolumes);
    if (persistentVolumes !== undefined && serviceType !== "server") {
      throw new CliError(`deployment.services.${serviceId} declares persistentVolumes but is a "serverless" service. A volume is a disk on one machine — it cannot be shared between instances, so each one would get its own separate copy. Change it to \`type: "server"\`, or drop the volume and keep state in a database or object storage instead.`);
    }

    const env = evaluateEnvRecord(serviceId, record.env);
    // Read (and type-checked) but deliberately NOT part of `definition`: the
    // dev command is only ever run locally by `hexclave dev --service-id`, so
    // it stays on this machine — see EvaluatedService.devCommand below.
    const devCommand = readOptionalStringField(record, serviceId, "devCommand");
    services.set(serviceId, {
      serviceId,
      definition: {
        type: serviceType,
        ports,
        min_instances: minInstances,
        max_instances: maxInstances,
        // Stored/displayed as a config-directory-relative posix path ("." for
        // the config directory itself) — an absolute local path would be
        // meaningless (and leak local filesystem layout) server-side.
        root_directory: relativeRootDirectory === "" ? "." : relativeRootDirectory.split(path.sep).join("/"),
        // Root-directory-relative posix path; absent = Railpack auto-detection.
        dockerfile_path: dockerfilePath,
        // Absent = the container filesystem is entirely ephemeral.
        persistent_volumes: persistentVolumes,
        env: serializeEnvForWire(env),
      },
      env,
      absoluteRootDirectory,
      devCommand,
    });
  }

  if (services.size === 0) {
    throw new CliError(`The services function of ${configPath} returned no services.`);
  }

  // A volume id names exactly one disk, so two services claiming the same id
  // would be asking to mount one disk on two machines — which Fly refuses, and
  // which would mean data loss for whichever service lost the race. This is the
  // flip side of ids being service-independent: moving an id between services is
  // supported precisely BECAUSE only one service may hold it at a time.
  const volumeIdOwners = new Map<string, string>();
  for (const [serviceId, service] of services) {
    for (const volumeId of Object.keys(service.definition.persistent_volumes ?? {})) {
      const existingOwner = volumeIdOwners.get(volumeId);
      if (existingOwner !== undefined) {
        throw new CliError(`The persistent volume id ${JSON.stringify(volumeId)} is claimed by both deployment.services.${existingOwner} and deployment.services.${serviceId}. A volume is one disk and can only be mounted by one service — give one of them a different id.`);
      }
      volumeIdOwners.set(volumeId, serviceId);
    }
  }

  // Every service("...") call must reference a defined service — a typo'd id
  // would otherwise only fail server-side at deploy time.
  for (const referencedServiceId of referencedServiceIds) {
    if (!services.has(referencedServiceId)) {
      throw new CliError(`service(${JSON.stringify(referencedServiceId)}) does not match any defined service. Available services: ${[...services.keys()].join(", ")}.`);
    }
  }
  // Reject connections the target's ports cannot satisfy, before uploading
  // anything. The backend enforces this too, but config evaluation can name
  // both services and the correct replacement immediately.
  //
  // `internalUrl` and `internalPort` each name ONE port, so a service with
  // several only breaks the reference, not itself — which is why this is
  // checked here, against the referrer, rather than when the target is parsed.
  for (const [serviceId, service] of services) {
    for (const [envVarKey, value] of Object.entries(service.env)) {
      if (value.kind !== "connection") continue;
      const [targetServiceId, outputKey] = value.reference.split(".");
      if (targetServiceId === HEXCLAVE_SERVICE_ID) continue;
      const target = services.get(targetServiceId);
      if (target == null) throw new CliError(`Internal error: validated service reference ${JSON.stringify(value.reference)} has no target definition.`);
      const at = `deployment.services.${serviceId}.env.${envVarKey}`;
      const targetPorts = target.definition.ports;
      const describePorts = () => targetPorts.map((entry) => `${entry.port} (${portTransport(entry)}${entry.public ? ", public" : ""})`).join(", ");

      // `url` deliberately does NOT require a public port: a private service
      // still gets one once a custom domain verifies. What it does require is
      // something HTTP to serve — a URL to a service that only speaks raw TCP
      // could never resolve.
      if (outputKey === "url" && targetPorts.every((entry) => portTransport(entry) === "tcp")) {
        throw new CliError(`${at} requests ${JSON.stringify(value.reference)}, but ${JSON.stringify(targetServiceId)} declares only TCP ports, so it can never have a URL. Use service(${JSON.stringify(targetServiceId)}).internalHost with an explicit port instead. Its ports: ${describePorts()}.`);
      }
      if (outputKey === "internalUrl" && soleHttpDeploymentPort(targetPorts) === null) {
        const httpPorts = targetPorts.filter((entry) => portTransport(entry) === "http");
        throw new CliError(httpPorts.length === 0
          ? `${at} requests ${JSON.stringify(value.reference)}, but ${JSON.stringify(targetServiceId)} declares no HTTP port, so there is no URL to build. Use service(${JSON.stringify(targetServiceId)}).internalHost with an explicit port instead. Its ports: ${describePorts()}.`
          : `${at} requests ${JSON.stringify(value.reference)}, but ${JSON.stringify(targetServiceId)} declares ${httpPorts.length} HTTP ports (${httpPorts.map((entry) => entry.port).join(", ")}), so which one the URL means is ambiguous. Use service(${JSON.stringify(targetServiceId)}).internalHost and write the port you want.`);
      }
      if (outputKey === "internalPort" && soleDeploymentPort(targetPorts) === null) {
        throw new CliError(`${at} requests ${JSON.stringify(value.reference)}, but ${JSON.stringify(targetServiceId)} declares ${targetPorts.length} ports (${targetPorts.map((entry) => entry.port).join(", ")}), so which one it means is ambiguous. Write the port number you want directly.`);
      }
    }
  }

  // A self-referential `url` can never be satisfied (the public URL only
  // exists once a domain verifies, which the service's own first deploy can't
  // provide). The internal outputs are deterministic and fine to self-reference.
  // Mirrors the backend check, but fails before anything is uploaded.
  for (const [serviceId, service] of services) {
    for (const [envVarKey, value] of Object.entries(service.env)) {
      if (value.kind === "connection" && value.reference === `${serviceId}.url`) {
        throw new CliError(`deployment.services.${serviceId}.env.${envVarKey} connects to the service's own public URL "${value.reference}", which cannot exist before the service does. Use service("${serviceId}").internalUrl for its own address.`);
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
      // Self-references never create a deploy edge: a self `url` is rejected outright above,
      // and self internal outputs are deterministic from the synced definition (they don't depend on the
      // service having deployed). Adding a self-edge here would make computeDeploymentLevels
      // report a false circular-dependency error for a config that deploys fine.
      if (targetServiceId !== HEXCLAVE_SERVICE_ID && targetServiceId !== serviceId && services.has(targetServiceId)) {
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
 * Collects a service's `secret(key, default)` fallbacks, keyed by env var key,
 * for the deploy request. These are NOT part of the synced definition: the
 * backend uses them only to fill secrets that have no stored value, and never
 * persists them — so the dashboard's secrets page can say "set" or "not
 * there" and nothing in between.
 */
export function collectSecretDefaults(service: EvaluatedService): Record<string, string> {
  const defaults = new Map<string, string>();
  for (const [envVarKey, value] of Object.entries(service.env)) {
    if (value.kind === "secret" && value.defaultValue !== undefined) {
      defaults.set(envVarKey, value.defaultValue);
    }
  }
  return Object.fromEntries(defaults);
}

/**
 * Resolves a dev-mode evaluated env record into literal values using the
 * development-environment session's env (which carries the project's
 * credentials). Called by `hexclave dev` after the session exists.
 */
export function resolveDevEnv(service: EvaluatedService, sessionEnv: Record<string, string>): Record<string, string> {
  const resolved = new Map<string, string>();
  for (const [envVarKey, value] of Object.entries(service.env)) {
    switch (value.kind) {
      case "plain": {
        resolved.set(envVarKey, value.value);
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
        resolved.set(envVarKey, value.defaultValue);
        break;
      }
      case "connection": {
        if (value.hexclaveOutputKey === undefined) {
          // Unreachable: in dev mode, service() returns null, so non-hexclave
          // connection refs cannot be constructed.
          throw new CliError(`Internal error: env var ${JSON.stringify(envVarKey)} is an unresolved service connection in dev mode.`);
        }
        resolved.set(envVarKey, resolveHexclaveOutputFromSessionEnv(envVarKey, value.hexclaveOutputKey, sessionEnv));
        break;
      }
    }
  }
  return Object.fromEntries(resolved);
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
export async function importConfigModule(configPath: string): Promise<{ config: unknown, deployment: unknown }> {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  let configModule: { config?: unknown, deployment?: unknown };
  try {
    configModule = await jiti.import(configPath);
  } catch (error: unknown) {
    throw new CliError(`Failed to load config file ${configPath}: ${errorMessage(error)}`);
  }
  return { config: configModule.config, deployment: configModule.deployment };
}
