import { connectionRequiresTargetDeployed, deploymentServiceIsPublic, parseConnectionValue } from "@hexclave/shared/dist/deployments";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getInternalUser } from "../lib/app.js";
import { isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuth } from "../lib/auth.js";
import { AuthError, CliError, errorMessage } from "../lib/errors.js";
import { packageSourceDirectory } from "../lib/source-packaging.js";
import { collectSecretDefaults, computeDeploymentLevels, evaluateDeploymentConfig, importConfigModule, importDeployModule, resolveDeployFilePath, type EvaluatedService } from "../lib/deployment-config.js";
import { buildConfigPushSource, parseConfigOverride, pushConfigToProject } from "./config-file.js";

// The names checked (in order) when --config-file is not passed with
// --config-push; same preference order as `hexclave config push`'s pull-side
// resolution.
const CONFIG_FILE_CANDIDATES = ["hexclave.config.ts", "hexclave.config.js", "stack.config.ts", "stack.config.js"];

const RUN_POLL_INTERVAL_MS = 3_000;
// Generous cap so a wedged remote build doesn't hang CI forever; the remote
// builder's own hard timeout is 15 minutes.
const RUN_POLL_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export type DeployOptions = {
  serviceId?: string,
  deployFile?: string,
  configFile?: string,
  cloudProjectId?: string,
  // Opt-in: pushing the project's configuration is a separate concern from
  // deploying this repository's services, and several repositories can deploy
  // into one project — so a deploy must not silently publish whichever config
  // file happens to sit next to the deploy file.
  configPush?: boolean,
};

/**
 * Resolves the project config file for `--config-push`: --config-file wins (and
 * must exist); otherwise the first existing candidate in cwd. Returns null when
 * nothing was passed and no candidate exists. Exported for unit tests.
 */
export function resolveConfigPushPath(configOption: string | undefined, cwd: string): string | null {
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
  return null;
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

export type ServiceDeployResult = {
  serviceId: string,
  status: "ready" | "error" | "canceled" | "skipped",
  runId: string | null,
  url: string | null,
  error: string | null,
};

export function collectPublicUrls(deploySet: string[], services: Map<string, EvaluatedService>, results: Map<string, ServiceDeployResult>) {
  return deploySet.flatMap((serviceId) => {
    const service = services.get(serviceId) ?? (() => {
      throw new CliError(`Internal error: deploy set contains unknown service ${JSON.stringify(serviceId)}.`);
    })();
    const result = results.get(serviceId) ?? (() => {
      throw new CliError(`Internal error: no deploy result for service ${JSON.stringify(serviceId)}.`);
    })();
    // A public port is always HTTP (raw TCP cannot be public), so its presence
    // is the whole condition for the service having a URL to report.
    return deploymentServiceIsPublic(service.definition.ports) && result.status === "ready" && result.url !== null
      ? [{ serviceId, url: result.url }]
      : [];
  });
}

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
  // The deployment (from POST /deployments/deployments) this run is grouped under.
  deploymentId: string,
  ignoreRootDirectory: string,
}): Promise<ServiceDeployResult> {
  const { auth, authHeaders, service, definitionSyncId, deploymentId, ignoreRootDirectory } = options;
  const serviceId = service.serviceId;
  const log = (message: string) => console.error(`[${serviceId}] ${message}`);

  const packaged = packageSourceDirectory(service.absoluteRootDirectory, ignoreRootDirectory);
  const dockerfilePath = service.definition.dockerfile_path;
  if (dockerfilePath !== undefined) {
    // The declared Dockerfile must be in the PACKAGED source — verify against the actual tar
    // contents (case-exact, after .gitignore/.dockerignore), not just the filesystem, so a
    // missing/ignored/case-mismatched Dockerfile fails before upload rather than minutes
    // later in the remote builder. (Docker never runs locally.)
    if (!packaged.paths.includes(dockerfilePath)) {
      const onDisk = fs.existsSync(path.join(service.absoluteRootDirectory, dockerfilePath));
      throw new CliError(onDisk
        ? `services.${serviceId} declares dockerfilePath ${JSON.stringify(dockerfilePath)} but that file isn't in the packaged source — check your .dockerignore/.gitignore (and that the path matches the filename case-exactly).`
        : `services.${serviceId} declares dockerfilePath ${JSON.stringify(dockerfilePath)}, but there is no such file under ${service.absoluteRootDirectory}.`);
    }
  } else if (packaged.paths.includes("Dockerfile")) {
    // No dockerfilePath means Railpack auto-detection — an existing Dockerfile is deliberately
    // NOT picked up implicitly, so say so instead of silently ignoring it.
    log(`Note: the source contains a Dockerfile, but services.${serviceId} does not set dockerfilePath, so the image will be built with Railpack auto-detection (https://railpack.com) instead. Set dockerfilePath: "Dockerfile" to build from it.`);
  }
  log(`Packaged ${packaged.fileCount} files (${(packaged.tarballGzipped.length / 1024).toFixed(1)} KiB compressed) from ${service.absoluteRootDirectory}.`);

  const upload = await deployApiFetch(auth, authHeaders, "/deployments/uploads", { method: "POST" });
  if (typeof upload?.id !== "string" || typeof upload?.upload_url !== "string" || typeof upload?.content_type !== "string") {
    throw new CliError("Unexpected response from the Hexclave API when creating the upload.");
  }
  if (typeof upload.max_bytes === "number" && packaged.tarballGzipped.length > upload.max_bytes) {
    throw new CliError(`The packaged source of ${JSON.stringify(serviceId)} is too large (${packaged.tarballGzipped.length} bytes, max ${upload.max_bytes}). Check your .gitignore/.dockerignore — build outputs and large assets shouldn't be uploaded.`);
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
      deployment_id: deploymentId,
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
  if (deploymentServiceIsPublic(service.definition.ports) && url === null) {
    throw new CliError(`The deployment of public service ${JSON.stringify(serviceId)} finished successfully, but the runtime did not return its public URL.`);
  }
  log(`Deployment succeeded${url != null ? `: ${url}` : "."}`);
  return { serviceId, status: "ready", runId, url, error: null };
}

/** Transitive dependents of `failedServiceId`, by connection edges. */
function collectTransitiveDependents(failedServiceId: string, services: Map<string, EvaluatedService>): Set<string> {
  const directDependents = new Map<string, Set<string>>();
  for (const [serviceId, service] of services) {
    for (const value of Object.values(service.env)) {
      if (value.kind !== "connection") continue;
      const parsed = parseConnectionValue(value.reference);
      // Same rule as computeDeploymentLevels: a deterministic reference is not a
      // dependency, so a failed target must not skip services that never needed
      // it to be deployed.
      if (parsed === null || !connectionRequiresTargetDeployed(parsed.outputKey, parsed.port)) continue;
      const target = parsed.serviceId;
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
    .description("Deploy the services defined by the `deployment` export of your hexclave.deploy.ts. Syncs the service definitions, then deploys every service in dependency order and waits for the remote builds to finish.")
    .option("--service-id <id>", "Deploy only this service (its connections resolve against already-deployed services)")
    .option("--deploy-file <path>", "Path to the deploy file (default: auto-discover hexclave.deploy.ts in the current directory)")
    .option("--config-push", "Also push the project config file's `config` export to the project before deploying")
    .option("--config-file <path>", "Path to the project config file for --config-push (default: auto-discover hexclave.config.ts in the current directory)")
    .option("--cloud-project-id <id>", "Hexclave project ID to deploy to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.\nSecrets: values for secret() env vars are read from the dashboard (Project Settings > Secrets); the deploy fails up front and lists every secret that still needs a value there.")
    .action(async (opts: DeployOptions) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      const authHeaders = await buildAuthHeadersFactory(auth);

      const deployFilePath = resolveDeployFilePath(opts.deployFile, process.cwd());
      const deployModule = await importDeployModule(deployFilePath);
      const { services } = evaluateDeploymentConfig({
        deployFilePath,
        deploymentExport: deployModule.deployment,
        mode: "deploy",
      });

      // The cycle check only matters when the whole graph deploys — a
      // single-service deploy resolves its connections against already-
      // deployed state, so a cycle elsewhere in the config must not block it.
      let levels: string[][];
      if (opts.serviceId != null) {
        const service = services.get(opts.serviceId);
        if (service == null) {
          throw new CliError(`No service named ${JSON.stringify(opts.serviceId)} in the deploy file's deployment.services. Available services: ${[...services.keys()].join(", ")}.`);
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

      // Config push is OPT-IN. A project can be deployed from several
      // repositories, and each push replaces the project's whole configuration —
      // so a deploy that published it by default would let any of those
      // repositories silently overwrite the others' config with its own.
      if (opts.configPush === true) {
        const configPath = resolveConfigPushPath(opts.configFile, process.cwd());
        if (configPath == null) {
          throw new CliError(`--config-push was passed, but no config file was found in ${process.cwd()} (looked for ${CONFIG_FILE_CANDIDATES.join(", ")}). Pass --config-file <path>, or drop --config-push to deploy without publishing the project config.`);
        }
        const configModule = await importConfigModule(configPath);
        if (configModule.config === undefined) {
          throw new CliError(`--config-push was passed, but ${configPath} has no \`config\` export. Add one, or drop --config-push.`);
        }
        const config = parseConfigOverride(configModule.config);
        if (config == null) {
          throw new CliError(`The \`config\` export of ${configPath} must be a plain object (or "show-onboarding"). Fix it, or drop --config-push to deploy without pushing the config.`);
        }
        console.error("Pushing config...");
        // The GitHub-Actions auto-detection inside buildConfigPushSource
        // records this path verbatim as the repo-relative config_file_path,
        // so pass a cwd-relative posix path, not the resolved absolute one
        // (which would bake the runner's filesystem layout into the source).
        const relativeConfigPath = path.relative(process.cwd(), configPath).split(path.sep).join("/");
        await pushConfigToProject(auth, config, buildConfigPushSource(relativeConfigPath, {}));
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

      // Group every run of this invocation under one deployment, so the
      // dashboard can show what shipped together instead of reconstructing it
      // from run timestamps. `deploySet` (not `services`) is what is planned:
      // a --service-id deploy syncs all definitions but deploys only one.
      const deploymentResponse = await deployApiFetch(auth, authHeaders, "/deployments/deployments", {
        method: "POST",
        jsonBody: { planned_service_ids: deploySet, triggered_by: "cli" },
      });
      if (typeof deploymentResponse?.id !== "string") {
        throw new CliError("Unexpected response from the Hexclave API when creating the deployment.");
      }
      const deploymentId = deploymentResponse.id;
      console.error(`Deployment #${deploymentResponse.number}`);

      // Deploy level by level: services in one level are independent and run
      // concurrently; a failure skips every transitive dependent but lets
      // independent branches finish.
      const ignoreRootDirectory = path.dirname(deployFilePath);
      const results = new Map<string, ServiceDeployResult>();
      const skipped = new Set<string>();
      // try/finally around the whole deploy: the deployment row was created
      // BEFORE any of this, and its status is derived from the runs underneath
      // it. A service that never gets a run reads as still-in-flight, which is
      // right while a deploy is progressing and wrong the moment this process
      // stops — so whatever happens from here, the server has to be told we are
      // done. Without it a deploy that died during packaging or upload leaves a
      // row the dashboard polls forever.
      try {
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
                deploymentId,
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

      } finally {
        // Best-effort, and deliberately swallowing: this is bookkeeping, so a
        // failure here must not replace the real deploy error the caller needs
        // to see, nor turn a successful deploy into a failed one. Worst case the
        // deployment keeps the status it would have had before this existed.
        try {
          await deployApiFetch(auth, authHeaders, `/deployments/deployments/${deploymentId}/conclude`, { method: "POST", jsonBody: {} });
        } catch (error) {
          console.error(`Warning: could not mark deployment #${deploymentResponse.number} as concluded (${errorMessage(error)}). Its status in the dashboard may stay in progress.`);
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
      const publicUrls = collectPublicUrls(deploySet, services, results);
      if (publicUrls.length > 0) {
        console.error("");
        console.error("Public URLs:");
        for (const publicUrl of publicUrls) console.error(`  ${publicUrl.serviceId}: ${publicUrl.url}`);
      }
      console.log(JSON.stringify({
        publicUrls,
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
