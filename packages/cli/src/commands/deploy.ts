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
  env: string[],
};

export type ParsedEnvVar = { key: string, value: string };

/**
 * Parses repeated `--env KEY=VALUE` options. Values may contain `=` (only the
 * first one separates key from value) and `{service.output}` references, which
 * are resolved server-side. Exported for unit tests.
 */
export function parseEnvOptions(envOptions: string[]): ParsedEnvVar[] {
  const seen = new Set<string>();
  return envOptions.map((option) => {
    const separatorIndex = option.indexOf("=");
    if (separatorIndex <= 0) {
      throw new CliError(`Invalid --env value ${JSON.stringify(option)}. Expected the KEY=VALUE format.`);
    }
    const key = option.slice(0, separatorIndex);
    const value = option.slice(separatorIndex + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new CliError(`Invalid --env key ${JSON.stringify(key)}. Keys must start with a letter or underscore and contain only letters, digits, and underscores.`);
    }
    if (seen.has(key)) {
      throw new CliError(`Duplicate --env key ${JSON.stringify(key)}.`);
    }
    seen.add(key);
    return { key, value };
  });
}

export type ServiceBuildConfig = {
  framework?: string,
  installCommand?: string,
  buildCommand?: string,
  outputDirectory?: string,
  rootDirectory?: string,
  domains: string[],
};

/**
 * Extracts one service's build config from a loaded config module. The config
 * file holds it under `deployments.services.<name>` — the exact shape that
 * `hexclave config push` pushes as branch config. Exported for unit tests.
 */
export function extractServiceBuildConfig(config: unknown, serviceName: string): ServiceBuildConfig {
  if (config == null || typeof config !== "object") {
    throw new CliError("Config file must export a plain `config` object.");
  }
  const services = (config as { deployments?: { services?: unknown } }).deployments?.services;
  if (services == null || typeof services !== "object") {
    throw new CliError("The config file has no `deployments.services` section. Add one, e.g.:\n  export const config = {\n    deployments: {\n      services: {\n        " + serviceName + ": { rootDirectory: \"./\", framework: \"nextjs\" },\n      },\n    },\n  };");
  }
  const service = (services as Record<string, unknown>)[serviceName];
  if (service == null || typeof service !== "object") {
    const available = Object.keys(services);
    throw new CliError(`No service named ${JSON.stringify(serviceName)} in the config file's \`deployments.services\`.${available.length > 0 ? ` Available services: ${available.join(", ")}` : ""}`);
  }
  const record = service as Record<string, unknown>;
  const readString = (key: string): string | undefined => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new CliError(`\`deployments.services.${serviceName}.${key}\` must be a string.`);
    }
    return value;
  };
  const domains: string[] = [];
  if (record.domains !== undefined) {
    if (record.domains == null || typeof record.domains !== "object" || Array.isArray(record.domains)) {
      throw new CliError(`\`deployments.services.${serviceName}.domains\` must be a record of domain entries, e.g. { "example-com": { hostname: "example.com" } }.`);
    }
    for (const [domainKey, domainValue] of Object.entries(record.domains as Record<string, unknown>)) {
      const hostname = (domainValue as { hostname?: unknown } | null)?.hostname;
      if (typeof hostname !== "string" || hostname === "") {
        throw new CliError(`\`deployments.services.${serviceName}.domains.${domainKey}\` must have a \`hostname\` string.`);
      }
      domains.push(hostname);
    }
  }
  return {
    framework: readString("framework"),
    installCommand: readString("installCommand"),
    buildCommand: readString("buildCommand"),
    outputDirectory: readString("outputDirectory"),
    rootDirectory: readString("rootDirectory"),
    domains,
  };
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
  rawBody?: Uint8Array,
}): Promise<any> {
  const url = `${auth.apiUrl.replace(/\/$/, "")}/api/latest${apiPath}`;
  const response = await fetch(url, {
    method: init.method,
    headers: {
      ...await getAuthHeaders(),
      ...(init.jsonBody !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.rawBody !== undefined ? { "content-type": "application/octet-stream" } : {}),
    },
    body: init.rawBody !== undefined
      // Copy into a plain ArrayBuffer: TS's BodyInit doesn't accept
      // Uint8Array<ArrayBufferLike>, and slicing also drops any surrounding
      // bytes of a shared buffer.
      ? new Uint8Array(init.rawBody).slice().buffer
      : (init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : undefined),
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

export function registerDeployCommand(program: Command) {
  program
    .command("deploy <service>")
    .description("Deploy a service defined under `deployments.services` in your hexclave.config.ts. Uploads the service's source directory; the build runs remotely. Fire-and-forget: prints the run id and exits once the deploy is queued.")
    .option("--config <path>", "Path to the config file (default: auto-discover hexclave.config.ts in the current directory)")
    .option("--cloud-project-id <id>", "Hexclave project ID to deploy to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .option("--env <KEY=VALUE>", "Env var for this deploy (repeatable). Values may contain {service.output} references, which are resolved server-side.", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.")
    .action(async (service: string, opts: DeployOptions) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      const envVars = parseEnvOptions(opts.env);
      const authHeaders = await buildAuthHeadersFactory(auth);

      const configPath = resolveDeployConfigPath(opts.config, process.cwd());
      let buildConfig: ServiceBuildConfig;
      let rootDirectory: string;
      if (configPath != null) {
        // Config-as-code mode: the config file's build config governs this
        // deploy and is upserted into the service definition by the backend.
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
        buildConfig = extractServiceBuildConfig(configModule.config, service);
        // The source directory is the service's rootDirectory, resolved
        // relative to the config file (not the cwd) so deploys behave the same
        // from anywhere in the repo.
        rootDirectory = path.resolve(path.dirname(configPath), buildConfig.rootDirectory ?? ".");
      } else {
        // Dashboard mode: no config file, so the service's configuration as
        // stored on the backend governs the deploy (the service must already
        // exist there). Only the root directory matters locally — it decides
        // what gets packaged — and is resolved against the cwd.
        const remoteService = await deployApiFetch(auth, authHeaders, `/deployments/services/${encodeURIComponent(service)}`, { method: "GET" });
        const remoteRootDirectory = typeof remoteService?.root_directory === "string" && remoteService.root_directory !== "" ? remoteService.root_directory : ".";
        // Send no build config: the backend falls back to the stored
        // definition field-by-field.
        buildConfig = { domains: [] };
        rootDirectory = path.resolve(process.cwd(), remoteRootDirectory);
        console.error(`No config file found — using the service configuration stored in Hexclave (root directory: ${remoteRootDirectory}).`);
      }
      console.error(`Packaging ${rootDirectory}...`);
      const packaged = packageSourceDirectory(rootDirectory);
      console.error(`Packaged ${packaged.fileCount} files (${(packaged.tarballGzipped.length / 1024).toFixed(1)} KiB compressed).`);

      const upload = await deployApiFetch(auth, authHeaders, "/deployments/uploads", { method: "POST" });
      if (typeof upload?.id !== "string" || typeof upload?.upload_path !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when creating the upload.");
      }
      if (typeof upload.max_bytes === "number" && packaged.tarballGzipped.length > upload.max_bytes) {
        throw new CliError(`The packaged source is too large (${packaged.tarballGzipped.length} bytes, max ${upload.max_bytes}). Check your .gitignore/.vercelignore — build outputs and large assets shouldn't be uploaded.`);
      }
      console.error(`Uploading source...`);
      await deployApiFetch(auth, authHeaders, upload.upload_path.replace(/^\/api\/latest/, ""), {
        method: "PUT",
        rawBody: packaged.tarballGzipped,
      });

      console.error(`Starting deployment of ${JSON.stringify(service)}...`);
      const deployResponse = await deployApiFetch(auth, authHeaders, `/deployments/services/${encodeURIComponent(service)}/deploy`, {
        method: "POST",
        jsonBody: {
          upload_id: upload.id,
          build_config: {
            ...(buildConfig.framework !== undefined ? { framework: buildConfig.framework } : {}),
            ...(buildConfig.installCommand !== undefined ? { install_command: buildConfig.installCommand } : {}),
            ...(buildConfig.buildCommand !== undefined ? { build_command: buildConfig.buildCommand } : {}),
            ...(buildConfig.outputDirectory !== undefined ? { output_directory: buildConfig.outputDirectory } : {}),
            ...(buildConfig.rootDirectory !== undefined ? { root_directory: buildConfig.rootDirectory } : {}),
            ...(buildConfig.domains.length > 0 ? { domains: buildConfig.domains } : {}),
          },
          env: envVars,
        },
      });
      if (typeof deployResponse?.run_id !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when starting the deployment.");
      }

      // Fire-and-forget by design: the build continues remotely. Exit 0 once
      // queued — CI does NOT fail on a failed build (a waiting/streaming flag
      // is planned post-MVP).
      console.log(JSON.stringify({ runId: deployResponse.run_id }, null, 2));
    });
}
