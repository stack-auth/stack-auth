import path from "node:path";
import { getInternalUser } from "../lib/app.js";
import { isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuth } from "../lib/auth.js";
import { AuthError, CliError, errorMessage } from "../lib/errors.js";
import { packageSourceDirectory } from "../lib/source-packaging.js";
import {
  assertSecretsMatchEnv,
  extractServiceDefinition,
  parseSecretOptions,
  resolveDeployConfigPath,
  type DeployOptions,
  type ServiceDefinition,
  type ServiceEnvVarConfig,
} from "../lib/deploy-config.js";

async function buildAuthHeadersFactory(auth: ProjectAuth): Promise<() => Promise<Record<string, string>>> {
  if (isProjectAuthWithSecretServerKey(auth)) {
    const headers = {
      "x-stack-access-type": "server",
      "x-stack-project-id": auth.projectId,
      "x-stack-secret-server-key": auth.secretServerKey,
    };
    return () => Promise.resolve(headers);
  }
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
      "content-type": contentType,
      "content-length": bytes.length.toString(),
    },
    body: new Uint8Array(bytes).slice().buffer,
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new CliError(`Source upload failed (${response.status} from object storage): ${responseBody.slice(0, 1000)}`);
  }
}

export async function runDeploy(service: string, opts: DeployOptions): Promise<void> {
  const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
  const secrets = parseSecretOptions(opts.secret);
  const authHeaders = await buildAuthHeadersFactory(auth);

  const configPath = resolveDeployConfigPath(opts.config, process.cwd());
  let definition: ServiceDefinition | undefined;
  let rootDirectory: string;
  let ignoreRootDirectory: string;
  if (configPath != null) {
    // Config-as-code mode: the config file's definition (build config and env
    // vars) governs this deploy and is upserted into the service definition by
    // the backend.
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url);
    let configModule: { config?: unknown };
    try {
      configModule = await jiti.import(configPath);
    } catch (err: unknown) {
      throw new CliError(`Failed to load config file ${configPath}: ${errorMessage(err)}`);
    }
    if (configModule.config == null) {
      throw new CliError(`Config file ${configPath} must export a \`config\` object (e.g. \`export const config = { "deployments-alpha": { services: { ... } } }\`).`);
    }
    definition = extractServiceDefinition(configModule.config, service);
    // Fail on missing/misspelled secrets BEFORE packaging and uploading. The
    // backend re-checks this authoritatively.
    assertSecretsMatchEnv(definition.env, secrets);
    // The source directory is the service's rootDirectory, resolved relative to
    // the config file (not the cwd) so deploys behave the same from anywhere in
    // the repo.
    ignoreRootDirectory = path.dirname(configPath);
    rootDirectory = path.resolve(ignoreRootDirectory, definition.rootDirectory ?? ".");
  } else {
    // Dashboard mode: no config file, so the service's definition as stored on
    // the backend governs the deploy (the service must already exist there).
    // The root directory decides what gets packaged and is resolved against the
    // cwd; the stored env definitions let us check the provided secrets before
    // uploading.
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
  // backend then uses the stored definition field-by-field. WITH a config file,
  // absent build fields are sent as null ("unset") — the file is the whole
  // truth, so deleting a field from it must actually remove the stored value
  // instead of silently keeping it forever.
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
  // Source preparation is synchronous, but the remote build continues after
  // this returns. CI therefore does NOT fail on a later build failure (a
  // waiting/streaming flag is planned post-MVP).
  console.log(JSON.stringify({ runId: deployResponse.run_id }, null, 2));
}
