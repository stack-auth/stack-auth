import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { isProjectAuthWithRefreshToken, isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuthWithSecretServerKey } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import { resolveConfigFilePathOption } from "../lib/config-file-path.js";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { detectImportPackageFromDir, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

const SHOW_ONBOARDING_STACK_CONFIG_VALUE = "show-onboarding";

function isConfigOverride(value: unknown): value is EnvironmentConfigOverrideOverride {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseConfigOverride(value: unknown): EnvironmentConfigOverrideOverride | null {
  if (value === SHOW_ONBOARDING_STACK_CONFIG_VALUE) {
    return {};
  }
  return isConfigOverride(value) ? value : null;
}

type BranchConfigSourceApi =
  | { type: "pushed-from-github", owner: string, repo: string, branch: string, commit_hash: string, config_file_path: string, workflow_path?: string }
  | { type: "pushed-from-unknown" }
  | { type: "unlinked" };

type SourceFlagOptions = {
  source?: string,
  sourceRepo?: string,
  sourcePath?: string,
  sourceWorkflowPath?: string,
};

const OWNER_REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

function parseOwnerRepo(value: string, flagName: string): { owner: string, repo: string } {
  const parts = value.split("/");
  if (parts.length !== 2 || !OWNER_REPO_SEGMENT.test(parts[0]) || !OWNER_REPO_SEGMENT.test(parts[1])) {
    throw new CliError(`${flagName} must be in the format 'owner/repo' using only letters, digits, '.', '_' or '-' (got '${value}').`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function parseGitHubRepositoryEnv(): { owner: string, repo: string } | null {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return null;
  }
  try {
    return parseOwnerRepo(repository, "GITHUB_REPOSITORY");
  } catch {
    return null;
  }
}

function normalizeRepoRelativePath(value: string, flagName: string): string {
  const normalized = value.trim().replace(/^(?:\.?\/+)+/, "");
  if (normalized.length === 0) {
    throw new CliError(`${flagName} must be a non-empty repo-relative path string.`);
  }
  return normalized;
}

export function buildConfigPushSource(configFilePath: string, flags: SourceFlagOptions): BranchConfigSourceApi {
  const dependentFlags: Array<[string, string | undefined]> = [
    ["--source-repo", flags.sourceRepo],
    ["--source-path", flags.sourcePath],
    ["--source-workflow-path", flags.sourceWorkflowPath],
  ];
  const providedDependent = dependentFlags.filter(([, v]) => v !== undefined).map(([k]) => k);

  if (flags.source !== undefined) {
    if (flags.source !== "github") {
      throw new CliError(`Invalid --source value '${flags.source}'. Only 'github' is supported.`);
    }
    const missing = dependentFlags.filter(([, v]) => v === undefined).map(([k]) => k);
    if (missing.length > 0) {
      throw new CliError(`When --source github is specified, the following flags are also required: ${missing.join(", ")}.`);
    }

    const { owner, repo } = parseOwnerRepo(
      flags.sourceRepo ?? throwErr("Expected --source-repo to be provided when --source github is specified; this should have been caught by the missing-flags check."),
      "--source-repo",
    );

    const sourcePath = normalizeRepoRelativePath(
      flags.sourcePath ?? throwErr("Expected --source-path to be provided when --source github is specified; this should have been caught by the missing-flags check."),
      "--source-path",
    );
    const sourceWorkflowPath = normalizeRepoRelativePath(
      flags.sourceWorkflowPath ?? throwErr("Expected --source-workflow-path to be provided when --source github is specified; this should have been caught by the missing-flags check."),
      "--source-workflow-path",
    );

    const sha = process.env.GITHUB_SHA;
    const branch = process.env.GITHUB_REF_NAME;
    if (!sha) {
      throw new CliError("--source github requires the GITHUB_SHA environment variable (commit hash) to be set.");
    }
    if (!branch) {
      throw new CliError("--source github requires the GITHUB_REF_NAME environment variable (branch) to be set.");
    }

    return {
      type: "pushed-from-github",
      owner,
      repo,
      branch,
      commit_hash: sha,
      config_file_path: sourcePath,
      workflow_path: sourceWorkflowPath,
    };
  }

  if (providedDependent.length > 0) {
    throw new CliError(`${providedDependent.join(", ")} can only be used with --source github.`);
  }

  const repository = parseGitHubRepositoryEnv();
  const sha = process.env.GITHUB_SHA;
  const branch = process.env.GITHUB_REF_NAME;

  if (repository && sha && branch) {
    return {
      type: "pushed-from-github",
      owner: repository.owner,
      repo: repository.repo,
      branch,
      commit_hash: sha,
      config_file_path: configFilePath,
    };
  }

  return { type: "pushed-from-unknown" };
}

async function pushConfigWithSecretServerKey(
  auth: ProjectAuthWithSecretServerKey,
  config: EnvironmentConfigOverrideOverride,
  source: BranchConfigSourceApi,
) {
  const endpoint = `${auth.apiUrl.replace(/\/$/, "")}/api/v1/internal/config/override/branch`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-stack-project-id": auth.projectId,
      "x-stack-access-type": "server",
      "x-stack-secret-server-key": auth.secretServerKey,
    },
    body: JSON.stringify({
      config_string: JSON.stringify(config),
      source,
    }),
  });

  if (response.ok) {
    return;
  }

  const responseText = await response.text();
  const message = responseText.length > 0
    ? responseText
    : `Request failed with status ${response.status}.`;
  throw new CliError(`Failed to push config with STACK_SECRET_SERVER_KEY: ${message}`);
}

function sourceToSdkSource(source: BranchConfigSourceApi):
  { type: "pushed-from-github", owner: string, repo: string, branch: string, commitHash: string, configFilePath: string, workflowPath?: string }
  | { type: "pushed-from-unknown" }
  | { type: "unlinked" } {
  if (source.type === "pushed-from-github") {
    return {
      type: "pushed-from-github",
      owner: source.owner,
      repo: source.repo,
      branch: source.branch,
      commitHash: source.commit_hash,
      configFilePath: source.config_file_path,
      workflowPath: source.workflow_path,
    };
  }
  if (source.type === "pushed-from-unknown") {
    return { type: "pushed-from-unknown" };
  }
  return { type: "unlinked" };
}

// Resolve the path for `config pull` when `--config-file` was omitted. Falls
// back to a config file in cwd, and throws a CliError with a clear hint
// if it isn't there. Exported for unit tests.
export function resolveConfigFilePathForPull(opts: { configFile?: string }, cwd: string): string {
  if (opts.configFile != null && opts.configFile !== "") {
    return resolveConfigFilePathOption(opts.configFile);
  }
  // Hexclave rebrand: prefer the new `hexclave.config.ts` filename, fall back
  // to the legacy `stack.config.ts` so existing projects keep working. If
  // neither exists, default to the new filename for the error/directory hint.
  const hexclaveCandidate = path.join(cwd, "hexclave.config.ts");
  const legacyCandidate = path.join(cwd, "stack.config.ts");
  const candidate = fs.existsSync(hexclaveCandidate) ? hexclaveCandidate : legacyCandidate;
  if (!fs.existsSync(candidate)) {
    throw new CliError("No --config-file provided and no hexclave.config.ts (or stack.config.ts) found in the current directory. Pass --config-file <path> or run this command in a directory containing a config file.");
  }
  if (fs.statSync(candidate).isDirectory()) {
    throw new CliError(`Default config path points to a directory instead of a file: ${candidate}`);
  }
  return candidate;
}

export function registerConfigCommand(program: Command) {
  const config = program
    .command("config")
    .description("Manage project configuration files");

  config
    .command("pull")
    .description("Pull branch config to a local file")
    .option("--cloud-project-id <id>", "Cloud project ID to pull config from (defaults to the STACK_PROJECT_ID env var)")
    .option("--config-file <path>", "Path to write config file (.ts); defaults to ./stack.config.ts in the current directory")
    .option("--overwrite", "Overwrite an existing config file")
    .action(async (opts) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      if (!isProjectAuthWithRefreshToken(auth)) {
        throw new CliError("`hexclave config pull` requires `hexclave login`. Remove STACK_SECRET_SERVER_KEY and try again.");
      }
      const project = await getAdminProject(auth);

      const configOverride = await project.getConfigOverride("branch");
      const filePath = resolveConfigFilePathForPull(opts, process.cwd());
      const ext = path.extname(filePath);

      if (ext !== ".ts") {
        throw new CliError("Config file must have a .ts extension. Typed config files require TypeScript.");
      }

      if (fs.existsSync(filePath) && !opts.overwrite) {
        throw new CliError(`Config file already exists at ${filePath}. Stage or back up your changes, then re-run with --overwrite.`);
      }

      const importPackage = detectImportPackageFromDir(path.dirname(filePath));
      const content = renderConfigFileContent(configOverride, importPackage);

      fs.writeFileSync(filePath, content);
      console.log(`Config written to ${filePath}`);
    });

  config
    .command("push")
    .description("Push a local config file to branch config")
    .option("--cloud-project-id <id>", "Cloud project ID to push config to (defaults to the STACK_PROJECT_ID env var)")
    .requiredOption("--config-file <path>", "Path to config file (.js or .ts)")
    .option("--source <type>", "Explicit source type for this push. Only 'github' is supported.")
    .option("--source-repo <owner/repo>", "GitHub repository in 'owner/repo' format. Only allowed with --source github.")
    .option("--source-path <path>", "Path to the config file within the source repository. Only allowed with --source github.")
    .option("--source-workflow-path <path>", "Path to the syncing workflow file within the source repository. Only allowed with --source github.")
    .action(async (opts) => {
      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));

      const filePath = resolveConfigFilePathOption(opts.configFile, { mustExist: true });
      const ext = path.extname(filePath);

      if (ext !== ".js" && ext !== ".ts") {
        throw new CliError("Config file must have a .js or .ts extension.");
      }

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);
      const configModule: { config?: unknown } = await jiti.import(filePath);

      const config = parseConfigOverride(configModule.config);
      if (config == null) {
        const examplePkg = detectImportPackageFromDir(path.dirname(filePath)) ?? "@hexclave/js";
        throw new CliError(`Config file must export a plain \`config\` object or "show-onboarding". Example: import type { StackConfig } from "${examplePkg}"; export const config: StackConfig = { ... };`);
      }

      const source = buildConfigPushSource(opts.configFile, {
        source: opts.source,
        sourceRepo: opts.sourceRepo,
        sourcePath: opts.sourcePath,
        sourceWorkflowPath: opts.sourceWorkflowPath,
      });

      if (isProjectAuthWithSecretServerKey(auth)) {
        await pushConfigWithSecretServerKey(auth, config, source);
      } else {
        if (!isProjectAuthWithRefreshToken(auth)) {
          throw new CliError("`hexclave config push` requires either STACK_SECRET_SERVER_KEY or `hexclave login`.");
        }
        const project = await getAdminProject(auth);
        await project.pushConfig(config, {
          source: sourceToSdkSource(source),
        });
      }

      console.log("Config pushed successfully.");
    });
}
