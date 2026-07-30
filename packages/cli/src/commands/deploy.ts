import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getInternalUser } from "../lib/app.js";
import { isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuth } from "../lib/auth.js";
import { AuthError, CliError, errorMessage } from "../lib/errors.js";
import { packageSourceDirectory } from "../lib/source-packaging.js";
import { collectSecretDefaults, computeDeploymentLevels, evaluateServicesFunction, importConfigModule, type EvaluatedService } from "../lib/services-config.js";
import { buildConfigPushSource, parseConfigOverride, pushConfigToProject } from "./config-file.js";

// The names checked (in order) when --config-file is not passed; same
// preference order as `hexclave config push`'s pull-side resolution.
const CONFIG_FILE_CANDIDATES = ["hexclave.config.ts", "hexclave.config.js", "stack.config.ts", "stack.config.js"];

const RUN_POLL_INTERVAL_MS = 3_000;
// Generous cap so a wedged remote build doesn't hang CI forever; Vercel's own
// build timeout is 45 minutes on most plans.
const RUN_POLL_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export type DeployOptions = {
  serviceId?: string,
  configFile?: string,
  cloudProjectId?: string,
  // commander's --no-config-push flag: true unless --no-config-push is passed.
  configPush: boolean,
};

/**
 * Resolves the config file path: --config-file wins (and must exist);
 * otherwise the first existing candidate in cwd. Unlike the pre-services CLI,
 * a config file is REQUIRED — service definitions only exist in its `services`
 * export. Exported for unit tests.
 */
export function resolveDeployConfigPath(configOption: string | undefined, cwd: string): string {
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
  throw new CliError(`No config file found in ${cwd}. \`hexclave deploy\` deploys the services defined by the \`services\` export of your hexclave.config.ts — create one, or pass --config-file <path>.`);
}

/**
 * The secret keys that MUST have a stored value for these services to deploy:
 * every secret referenced without a default value. Exported for unit tests.
 */
export function collectRequiredSecretKeys(services: EvaluatedService[]): string[] {
  const requiredKeys = new Set<string>();
  for (const service of services) {
    for (const value of Object.values(service.env)) {
      if (value.kind === "secret" && value.defaultValue === undefined) {
        requiredKeys.add(value.secretKey);
      }
    }
  }
  return [...requiredKeys].sort();
}

// Returns a FACTORY rather than a fixed header object: the deploy flow can
// span minutes (large uploads, remote builds), and the refresh-token path's
// access token may expire mid-flow. getTokens() transparently refreshes when
// needed, so calling the factory per request always yields a valid token; the
// secret-server-key path is static.
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

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

type ServiceDeployResult = {
  serviceId: string,
  status: "ready" | "error" | "canceled" | "skipped",
  runId: string | null,
  url: string | null,
  error: string | null,
};

/**
 * Deploys one service end-to-end: package, upload, start the deployment, then
 * poll its run until the remote build finishes. Log lines are prefixed with
 * the service id because services within one dependency level deploy
 * concurrently and their output interleaves.
 */
export async function deployService(options: {
  auth: ProjectAuth,
  authHeaders: () => Promise<Record<string, string>>,
  service: EvaluatedService,
  definitionSyncId: string,
  ignoreRootDirectory: string,
}): Promise<ServiceDeployResult> {
  const { auth, authHeaders, service, definitionSyncId, ignoreRootDirectory } = options;
  const serviceId = service.serviceId;
  const log = (message: string) => console.error(`[${serviceId}] ${message}`);

  const packaged = packageSourceDirectory(service.absoluteRootDirectory, ignoreRootDirectory, {
    includeFiles: service.includeFiles,
    excludeFiles: service.excludeFiles,
  });
  log(`Packaged ${packaged.fileCount} files (${(packaged.tarballGzipped.length / 1024).toFixed(1)} KiB compressed) from ${service.absoluteRootDirectory}.`);

  const upload = await deployApiFetch(auth, authHeaders, "/deployments/uploads", { method: "POST" });
  if (typeof upload?.id !== "string" || typeof upload?.upload_url !== "string" || typeof upload?.content_type !== "string") {
    throw new CliError("Unexpected response from the Hexclave API when creating the upload.");
  }
  if (typeof upload.max_bytes === "number" && packaged.tarballGzipped.length > upload.max_bytes) {
    throw new CliError(`The packaged source of ${JSON.stringify(serviceId)} is too large (${packaged.tarballGzipped.length} bytes, max ${upload.max_bytes}). Check your .gitignore/.vercelignore — build outputs and large assets shouldn't be uploaded.`);
  }
  log("Uploading source...");
  await uploadSource(upload.upload_url, upload.content_type, packaged.tarballGzipped);

  log("Starting deployment...");
  const deployResponse = await deployApiFetch(auth, authHeaders, `/deployments/services/${encodeURIComponent(serviceId)}/deploy`, {
    method: "POST",
    // The `secret()` defaults ride along with the deploy instead of being
    // synced with the definition: they are a config-file concept, and storing
    // them would make the dashboard's secrets page report a value that isn't
    // actually stored anywhere.
    jsonBody: {
      upload_id: upload.id,
      definition_sync_id: definitionSyncId,
      secret_defaults: collectSecretDefaults(service),
    },
  });
  if (typeof deployResponse?.run_id !== "string") {
    throw new CliError("Unexpected response from the Hexclave API when starting the deployment.");
  }
  const runId = deployResponse.run_id;
  log(`Run ${runId} started. Waiting for the remote build...`);

  // Follow the remote build to its terminal status. Polling spans many
  // minutes, so transient failures (a network blip, a 5xx from the API) must
  // not kill the deploy — only several CONSECUTIVE failures do.
  const startedAtMs = performance.now();
  let lastLoggedStatus: string | null = null;
  let consecutivePollFailures = 0;
  let run: any;
  while (true) {
    try {
      run = await deployApiFetch(auth, authHeaders, `/deployments/runs/${encodeURIComponent(runId)}`, { method: "GET" });
      consecutivePollFailures = 0;
    } catch (error) {
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new CliError(`Polling the remote build of ${JSON.stringify(serviceId)} (run ${runId}) failed ${consecutivePollFailures} times in a row: ${errorMessage(error)}\nThe build may still be running — check the run's status in the dashboard.`);
      }
      log(`Polling the build status failed (attempt ${consecutivePollFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}), retrying: ${errorMessage(error)}`);
      await wait(RUN_POLL_INTERVAL_MS);
      continue;
    }
    const status = typeof run?.status === "string" ? run.status : "unknown";
    if (status !== lastLoggedStatus && (status === "queued" || status === "building")) {
      log(`Build ${status}...`);
      lastLoggedStatus = status;
    }
    if (status === "ready" || status === "error" || status === "canceled") {
      break;
    }
    if (performance.now() - startedAtMs > RUN_POLL_TIMEOUT_MS) {
      throw new CliError(`Timed out waiting for the remote build of ${JSON.stringify(serviceId)} (run ${runId}). Check the run's status in the dashboard.`);
    }
    await wait(RUN_POLL_INTERVAL_MS);
  }

  if (run.status !== "ready") {
    const error = typeof run.error === "string" && run.error !== "" ? run.error : `Deployment ${run.status}.`;
    log(`Deployment failed: ${error}`);
    return { serviceId, status: run.status, runId, url: null, error };
  }

  // The run's immutable per-deployment URL is sufficient to report success.
  // Do not make a second, cosmetic service lookup for a custom-domain URL here:
  // a transient failure after the build is already READY must not turn the
  // successful deploy into an error and skip its transitive dependents.
  const url = typeof run.url === "string" ? run.url : null;
  log(`Deployment succeeded${url != null ? `: ${url}` : "."}`);
  return { serviceId, status: "ready", runId, url, error: null };
}

/** Transitive dependents of `failedServiceId`, by connection edges. */
function collectTransitiveDependents(failedServiceId: string, services: Map<string, EvaluatedService>): Set<string> {
  const directDependents = new Map<string, Set<string>>();
  for (const [serviceId, service] of services) {
    for (const value of Object.values(service.env)) {
      if (value.kind !== "connection") continue;
      const target = value.reference.split(".")[0];
      if (services.has(target)) {
        const dependents = directDependents.get(target) ?? new Set<string>();
        dependents.add(serviceId);
        directDependents.set(target, dependents);
      }
    }
  }
  const result = new Set<string>();
  const queue = [failedServiceId];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const dependent of directDependents.get(current) ?? []) {
      if (!result.has(dependent)) {
        result.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return result;
}

export function registerDeployCommand(program: Command) {
  program
    .command("deploy")
    .description("Deploy the services defined by the `services` export of your hexclave.config.ts. Pushes the config file to the project (unless --no-config-push), syncs the service definitions, then deploys every service in dependency order and waits for the remote builds to finish.")
    .option("--service-id <id>", "Deploy only this service (its connections resolve against already-deployed services)")
    .option("--config-file <path>", "Path to the config file (default: auto-discover hexclave.config.ts in the current directory)")
    .option("--cloud-project-id <id>", "Hexclave project ID to deploy to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .option("--no-config-push", "Skip pushing the config file's `config` export to the project before deploying")
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.\nSecrets: values for secret() env vars are read from the dashboard (Project Settings > Secrets); the deploy fails up front and lists every secret that still needs a value there.")
    .action(async (opts: DeployOptions) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      const authHeaders = await buildAuthHeadersFactory(auth);

      const configPath = resolveDeployConfigPath(opts.configFile, process.cwd());
      const configModule = await importConfigModule(configPath);
      const { services } = evaluateServicesFunction({
        configPath,
        servicesExport: configModule.services,
        mode: "deploy",
      });

      // The cycle check only matters when the whole graph deploys — a
      // single-service deploy resolves its connections against already-
      // deployed state, so a cycle elsewhere in the config must not block it.
      let levels: string[][];
      if (opts.serviceId != null) {
        const service = services.get(opts.serviceId);
        if (service == null) {
          throw new CliError(`No service named ${JSON.stringify(opts.serviceId)} in the config file's services export. Available services: ${[...services.keys()].join(", ")}.`);
        }
        levels = [[opts.serviceId]];
      } else {
        levels = computeDeploymentLevels(services);
      }
      const deploySet = levels.flat();

      // Pre-flight: every secret without a default must have a stored value
      // BEFORE anything is packaged or uploaded. The backend re-checks this
      // authoritatively per deploy.
      const requiredSecretKeys = collectRequiredSecretKeys(deploySet.map((serviceId) => services.get(serviceId) ?? (() => {
        throw new CliError(`Internal error: deploy set contains unknown service ${JSON.stringify(serviceId)}.`);
      })()));
      if (requiredSecretKeys.length > 0) {
        const storedSecrets = await deployApiFetch(auth, authHeaders, "/project-secrets", { method: "GET" });
        const storedKeys = new Set<string>(
          (Array.isArray(storedSecrets?.items) ? storedSecrets.items : [])
            .map((item: any) => item?.key)
            .filter((key: unknown): key is string => typeof key === "string"),
        );
        const missing = requiredSecretKeys.filter((key) => !storedKeys.has(key));
        if (missing.length > 0) {
          // One error listing EVERY missing key, not one per key: fixing these
          // means a trip to the dashboard, and finding out about the second
          // missing secret only after setting the first would mean a round
          // trip per secret.
          throw new CliError([
            `Missing ${missing.length === 1 ? "a value" : "values"} for ${missing.length === 1 ? "this secret" : `these ${missing.length} secrets`}:`,
            ...missing.map((key) => `  - ${key}`),
            "",
            "All of them must be set in the dashboard under Project Settings > Secrets before this deploy can run.",
          ].join("\n"));
        }
      }

      // Config push (default on): the config file is the source of truth for
      // the project's configuration, so deploying also publishes it.
      if (opts.configPush) {
        if (configModule.config === undefined) {
          console.error("Note: the config file has no `config` export, so there is no project config to push. (Pass --no-config-push to silence this.)");
        } else {
          const config = parseConfigOverride(configModule.config);
          if (config == null) {
            throw new CliError(`The \`config\` export of ${configPath} must be a plain object (or "show-onboarding"). Fix it, or pass --no-config-push to deploy without pushing the config.`);
          }
          console.error("Pushing config...");
          // The GitHub-Actions auto-detection inside buildConfigPushSource
          // records this path verbatim as the repo-relative config_file_path,
          // so pass a cwd-relative posix path, not the resolved absolute one
          // (which would bake the runner's filesystem layout into the source).
          const relativeConfigPath = path.relative(process.cwd(), configPath).split(path.sep).join("/");
          await pushConfigToProject(auth, config, buildConfigPushSource(relativeConfigPath, {}));
        }
      }

      // Sync ALL definitions (even for a --service-id deploy) so the dashboard
      // always reflects the full services export.
      console.error(`Syncing ${services.size} service definition${services.size === 1 ? "" : "s"}...`);
      const syncResponse = await deployApiFetch(auth, authHeaders, "/deployments/services", {
        method: "PUT",
        jsonBody: {
          services: Object.fromEntries([...services.values()].map((service) => [service.serviceId, service.definition])),
        },
      });
      if (typeof syncResponse?.sync_id !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when syncing service definitions.");
      }
      const definitionSyncId = syncResponse.sync_id;

      // Deploy level by level: services in one level are independent and run
      // concurrently; a failure skips every transitive dependent but lets
      // independent branches finish.
      const ignoreRootDirectory = path.dirname(configPath);
      const results = new Map<string, ServiceDeployResult>();
      const skipped = new Set<string>();
      for (const level of levels) {
        const toDeploy = level.filter((serviceId) => !skipped.has(serviceId));
        for (const serviceId of level) {
          if (skipped.has(serviceId)) {
            console.error(`[${serviceId}] Skipped (a service it depends on failed to deploy).`);
            results.set(serviceId, { serviceId, status: "skipped", runId: null, url: null, error: "Skipped because a dependency failed to deploy." });
          }
        }
        // Every outcome — including thrown errors (packaging failures, upload
        // errors, poll give-ups) — must become a RESULT: a rejection here
        // would abandon sibling deploys mid-flight and skip both summaries,
        // leaving CI with no machine-readable output at all.
        const levelResults = await Promise.all(toDeploy.map(async (serviceId): Promise<ServiceDeployResult> => {
          try {
            return await deployService({
              auth,
              authHeaders,
              service: services.get(serviceId) ?? (() => {
                throw new CliError(`Internal error: deploy level contains unknown service ${JSON.stringify(serviceId)}.`);
              })(),
              definitionSyncId,
              ignoreRootDirectory,
            });
          } catch (error) {
            const message = errorMessage(error);
            console.error(`[${serviceId}] Deploy failed: ${message}`);
            return { serviceId, status: "error", runId: null, url: null, error: message };
          }
        }));
        for (const result of levelResults) {
          results.set(result.serviceId, result);
          if (result.status !== "ready") {
            for (const dependent of collectTransitiveDependents(result.serviceId, services)) {
              if (deploySet.includes(dependent) && !results.has(dependent)) {
                skipped.add(dependent);
              }
            }
          }
        }
      }

      // Human summary on stderr, machine-readable summary on stdout.
      console.error("");
      for (const serviceId of deploySet) {
        const result = results.get(serviceId) ?? (() => {
          throw new CliError(`Internal error: no deploy result for service ${JSON.stringify(serviceId)}.`);
        })();
        const statusLabel = result.status === "ready" ? "deployed" : result.status;
        console.error(`  ${serviceId}: ${statusLabel}${result.url != null ? ` — ${result.url}` : ""}${result.error != null && result.status !== "skipped" ? ` — ${result.error}` : ""}`);
      }
      console.log(JSON.stringify({
        services: Object.fromEntries([...results.values()].map((result) => [result.serviceId, {
          status: result.status,
          runId: result.runId,
          url: result.url,
          error: result.error,
        }])),
      }, null, 2));

      if ([...results.values()].some((result) => result.status !== "ready")) {
        process.exitCode = 1;
      }
    });
}
