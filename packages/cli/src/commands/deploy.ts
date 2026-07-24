import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getInternalUser } from "../lib/app.js";
import { isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuth } from "../lib/auth.js";
import { AuthError, CliError, errorMessage } from "../lib/errors.js";
import { packageSourceDirectory } from "../lib/source-packaging.js";

// The names checked (in order) when --config is not passed; same preference
// order as `hexclave config push`'s pull-side resolution.
const CONFIG_FILE_CANDIDATES = ["hexclave.config.ts", "hexclave.config.js", "stack.config.ts", "stack.config.js"];

export type DeployOptions = {
  config?: string,
  cloudProjectId?: string,
  secret: string[],
};

const SECRET_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;
const ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Must match the backend's connection value validation: `<serviceId>.<outputKey>`.
const CONNECTION_VALUE_REGEX = /^[a-zA-Z0-9_-]+\.[A-Za-z0-9_]+$/;

/**
 * Parses repeated `--secret KEY=VALUE` options. Values may contain `=` (only
 * the first one separates key from value). Keys are the secret keys named by
 * `type: "secret"` env vars in the config; values are never persisted by
 * Hexclave. Exported for unit tests.
 */
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

// The config-side shape of one env var. Mirrors the schema of
// `deployments.services.<name>.env.<KEY>` and is sent to the deploy endpoint
// verbatim.
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

/**
 * Extracts one service's definition from a loaded config module. The config
 * file holds it under `deployments.services.<name>` — the exact shape that
 * `hexclave config push` pushes as branch config. Exported for unit tests.
 */
export function extractServiceDefinition(config: unknown, serviceName: string): ServiceDefinition {
  if (config == null || typeof config !== "object") {
    throw new CliError("Config file must export a plain `config` object.");
  }
  const services = (config as { deployments?: { services?: unknown } }).deployments?.services;
  if (services == null || typeof services !== "object") {
    throw new CliError("The config file has no `deployments.services` section. Add one, e.g.:\n  export const config = {\n    deployments: {\n      services: {\n        " + serviceName + ": { type: \"vercel\", rootDirectory: \"./\", framework: \"nextjs\" },\n      },\n    },\n  };");
  }
  const service = (services as Record<string, unknown>)[serviceName];
  if (service == null || typeof service !== "object") {
    const available = Object.keys(services);
    throw new CliError(`No service named ${JSON.stringify(serviceName)} in the config file's \`deployments.services\`.${available.length > 0 ? ` Available services: ${available.join(", ")}` : ""}`);
  }
  const record = service as Record<string, unknown>;
  if (record.type !== "vercel") {
    throw new CliError(record.type === undefined
      ? `\`deployments.services.${serviceName}\` has no \`type\`. Add \`type: "vercel"\`.`
      : `\`deployments.services.${serviceName}.type\` must be "vercel" (got ${JSON.stringify(record.type)}).`);
  }
  const readString = (key: string): string | undefined => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new CliError(`\`deployments.services.${serviceName}.${key}\` must be a string.`);
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
    throw new CliError(`\`deployments.services.${serviceName}.env\` must be a record of env var entries, e.g. { MY_VAR: { value: "some-value" } }.`);
  }
  const result: Record<string, ServiceEnvVarConfig> = {};
  for (const [envVarKey, entryValue] of Object.entries(env as Record<string, unknown>)) {
    const path = `\`deployments.services.${serviceName}.env.${envVarKey}\``;
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

/**
 * Checks the provided secrets against the secret keys the env definitions
 * reference, so a missing or misspelled secret fails BEFORE packaging and
 * uploading. The backend re-checks this authoritatively. Exported for unit
 * tests.
 */
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

/**
 * Resolves the config file path: --config wins (and must exist); otherwise the
 * first existing candidate in cwd, or undefined when there is none — the
 * config file is optional, deploys then use the service's configuration as
 * stored on the backend (dashboard-configured). Exported for unit tests.
 */
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

// Returns a FACTORY rather than a fixed header object: the deploy flow can
// span minutes (large uploads), and the refresh-token path's access token may
// expire mid-flow. getTokens() transparently refreshes when needed, so calling
// the factory per request always yields a valid token; the secret-server-key
// path is static.
async function buildAuthHeadersFactory(auth: ProjectAuth): Promise<() => Promise<Record<string, string>>> {
  if (isProjectAuthWithSecretServerKey(auth)) {
    const headers = {
      "x-stack-access-type": "server",
      "x-stack-project-id": auth.projectId,
      "x-stack-secret-server-key": auth.secretServerKey,
    };
    return () => Promise.resolve(headers);
  }
  // Refresh-token auth: the admin access token for a project is simply the
  // internal-project access token of a user who owns it.
  const user = await getInternalUser(auth);
  return async () => {
    const { accessToken } = await user.currentSession.getTokens();
    if (accessToken == null) {
      throw new AuthError("Could not obtain an access token. Run `hexclave login` again.");
    }
    return {
      "x-stack-access-type": "admin",
      "x-stack-project-id": auth.projectId,
      "x-stack-admin-access-token": accessToken,
    };
  };
}

// Returns `any` on purpose: this is a thin JSON transport; each call site
// immediately validates the specific fields it needs (and errors cleanly on
// unexpected shapes), so a structural type here would just duplicate that.
async function deployApiFetch(auth: ProjectAuth, getAuthHeaders: () => Promise<Record<string, string>>, apiPath: string, init: {
  method: string,
  jsonBody?: unknown,
}): Promise<any> {
  const url = `${auth.apiUrl.replace(/\/$/, "")}/api/latest${apiPath}`;
  const response = await fetch(url, {
    method: init.method,
    headers: {
      ...await getAuthHeaders(),
      ...(init.jsonBody !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.error === "string") message = parsed.error;
      else if (typeof parsed?.error?.message === "string") message = parsed.error.message;
    } catch {
      // Response body isn't JSON; use it as-is.
    }
    throw new CliError(`Deploy request failed (${response.status} at ${init.method} ${apiPath}): ${message.slice(0, 1000)}`);
  }
  try {
    return text === "" ? undefined : JSON.parse(text);
  } catch {
    throw new CliError(`Unexpected non-JSON response from the Hexclave API at ${init.method} ${apiPath}.`);
  }
}

async function uploadSource(uploadUrl: string, contentType: string, bytes: Uint8Array): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(uploadUrl);
  } catch {
    throw new CliError("The Hexclave API returned an invalid object-storage upload URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new CliError("The Hexclave API returned an upload URL with an unsupported protocol.");
  }
  const response = await fetch(parsedUrl, {
    method: "PUT",
    headers: {
      // This header is signed into the R2/S3 URL and must match exactly.
      "content-type": contentType,
      "content-length": bytes.length.toString(),
    },
    // Copy into a plain ArrayBuffer: TS's BodyInit doesn't accept
    // Uint8Array<ArrayBufferLike>, and slicing also drops any surrounding
    // bytes of a shared buffer.
    body: new Uint8Array(bytes).slice().buffer,
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new CliError(`Source upload failed (${response.status} from object storage): ${responseBody.slice(0, 1000)}`);
  }
}

export function registerDeployCommand(program: Command) {
  program
    .command("deploy <service>")
    .description("Deploy a service defined under `deployments.services` in your hexclave.config.ts. Uploads the service's source directory, waits for Vercel to accept the deployment, then prints the run id without waiting for the remote build to finish.")
    .option("--config <path>", "Path to the config file (default: auto-discover hexclave.config.ts in the current directory)")
    .option("--cloud-project-id <id>", "Hexclave project ID to deploy to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .option("--secret <KEY=VALUE>", "Value for a secret env var of this deploy (repeatable). KEY is the secret key named by a `type: \"secret\"` env var in the config; the value is pushed to the deployment target and never persisted by Hexclave.", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.")
    .action(async (service: string, opts: DeployOptions) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      const secrets = parseSecretOptions(opts.secret);
      const authHeaders = await buildAuthHeadersFactory(auth);

      const configPath = resolveDeployConfigPath(opts.config, process.cwd());
      let definition: ServiceDefinition | undefined;
      let rootDirectory: string;
      let ignoreRootDirectory: string;
      if (configPath != null) {
        // Config-as-code mode: the config file's definition (build config and
        // env vars) governs this deploy and is upserted into the service
        // definition by the backend.
        const { createJiti } = await import("jiti");
        const jiti = createJiti(import.meta.url);
        let configModule: { config?: unknown };
        try {
          configModule = await jiti.import(configPath);
        } catch (err: unknown) {
          throw new CliError(`Failed to load config file ${configPath}: ${errorMessage(err)}`);
        }
        if (configModule.config == null) {
          throw new CliError(`Config file ${configPath} must export a \`config\` object (e.g. \`export const config = { deployments: { services: { ... } } }\`).`);
        }
        definition = extractServiceDefinition(configModule.config, service);
        // Fail on missing/misspelled secrets BEFORE packaging and uploading.
        // The backend re-checks this authoritatively.
        assertSecretsMatchEnv(definition.env, secrets);
        // The source directory is the service's rootDirectory, resolved
        // relative to the config file (not the cwd) so deploys behave the same
        // from anywhere in the repo.
        ignoreRootDirectory = path.dirname(configPath);
        rootDirectory = path.resolve(ignoreRootDirectory, definition.rootDirectory ?? ".");
      } else {
        // Dashboard mode: no config file, so the service's definition as
        // stored on the backend governs the deploy (the service must already
        // exist there). The root directory decides what gets packaged and is
        // resolved against the cwd; the stored env definitions let us check
        // the provided secrets before uploading.
        const remoteService = await deployApiFetch(auth, authHeaders, `/deployments/services/${encodeURIComponent(service)}`, { method: "GET" });
        const remoteRootDirectory = typeof remoteService?.root_directory === "string" && remoteService.root_directory !== "" ? remoteService.root_directory : ".";
        const remoteEnv: Record<string, ServiceEnvVarConfig> = {};
        for (const envVar of Array.isArray(remoteService?.env) ? remoteService.env : []) {
          if (envVar?.type === "secret" && typeof envVar.secret_key === "string" && typeof envVar.key === "string") {
            remoteEnv[envVar.key] = { type: "secret", key: envVar.secret_key };
          }
        }
        assertSecretsMatchEnv(remoteEnv, secrets);
        ignoreRootDirectory = process.cwd();
        rootDirectory = path.resolve(process.cwd(), remoteRootDirectory);
        console.error(`No config file found — using the service configuration stored in Hexclave (root directory: ${remoteRootDirectory}).`);
      }
      console.error(`Packaging ${rootDirectory}...`);
      const packaged = packageSourceDirectory(rootDirectory, ignoreRootDirectory);
      console.error(`Packaged ${packaged.fileCount} files (${(packaged.tarballGzipped.length / 1024).toFixed(1)} KiB compressed).`);

      const upload = await deployApiFetch(auth, authHeaders, "/deployments/uploads", { method: "POST" });
      if (typeof upload?.id !== "string" || typeof upload?.upload_url !== "string" || typeof upload?.content_type !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when creating the upload.");
      }
      if (typeof upload.max_bytes === "number" && packaged.tarballGzipped.length > upload.max_bytes) {
        throw new CliError(`The packaged source is too large (${packaged.tarballGzipped.length} bytes, max ${upload.max_bytes}). Check your .gitignore/.vercelignore — build outputs and large assets shouldn't be uploaded.`);
      }
      console.error(`Uploading source...`);
      await uploadSource(upload.upload_url, upload.content_type, packaged.tarballGzipped);

      console.error(`Starting deployment of ${JSON.stringify(service)}...`);
      // Without a config file, build_config and env are omitted entirely: the
      // backend then uses the stored definition field-by-field. WITH a config
      // file, absent build fields are sent as null ("unset") — the file is the
      // whole truth, so deleting a field from it must actually remove the
      // stored value instead of silently keeping it forever.
      const deployResponse = await deployApiFetch(auth, authHeaders, `/deployments/services/${encodeURIComponent(service)}/deploy`, {
        method: "POST",
        jsonBody: {
          upload_id: upload.id,
          ...(definition !== undefined ? {
            build_config: {
              framework: definition.framework ?? null,
              install_command: definition.installCommand ?? null,
              build_command: definition.buildCommand ?? null,
              output_directory: definition.outputDirectory ?? null,
              root_directory: definition.rootDirectory ?? null,
            },
            env: definition.env,
          } : {}),
          ...(secrets.size > 0 ? { secrets: Object.fromEntries(secrets) } : {}),
        },
      });
      if (typeof deployResponse?.run_id !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when starting the deployment.");
      }

      // Source preparation is synchronous, but the remote build continues
      // after this returns. CI therefore does NOT fail on a later build
      // failure (a waiting/streaming flag is planned post-MVP).
      console.log(JSON.stringify({ runId: deployResponse.run_id }, null, 2));
    });
}
