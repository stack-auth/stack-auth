import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { isProjectAuthWithRefreshToken, isProjectAuthWithSecretServerKey, resolveAuth, type ProjectAuthWithSecretServerKey } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import type { EnvironmentConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import { detectImportPackageFromDir, renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";

function isConfigOverride(value: unknown): value is EnvironmentConfigOverrideOverride {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type BranchConfigSourceApi =
  | { type: "pushed-from-github", owner: string, repo: string, branch: string, commit_hash: string, config_file_path: string }
  | { type: "pushed-from-unknown" }
  | { type: "unlinked" };

function parseGitHubRepository(): { owner: string, repo: string } | null {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return null;
  }

  const slashIndex = repository.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= repository.length - 1) {
    return null;
  }

  return {
    owner: repository.slice(0, slashIndex),
    repo: repository.slice(slashIndex + 1),
  };
}

function buildConfigPushSource(configFilePath: string): BranchConfigSourceApi {
  const repository = parseGitHubRepository();
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
  { type: "pushed-from-github", owner: string, repo: string, branch: string, commitHash: string, configFilePath: string }
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
    };
  }
  if (source.type === "pushed-from-unknown") {
    return { type: "pushed-from-unknown" };
  }
  return { type: "unlinked" };
}

export function registerConfigCommand(program: Command) {
  const config = program
    .command("config")
    .description("Manage project configuration files");

  config
    .command("pull")
    .description("Pull branch config to a local file")
    .requiredOption("--config-file <path>", "Path to write config file (.ts)")
    .option("--overwrite", "Overwrite an existing config file")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);
      if (!isProjectAuthWithRefreshToken(auth)) {
        throw new CliError("`stack config pull` requires `stack login`. Remove STACK_SECRET_SERVER_KEY and try again.");
      }
      const project = await getAdminProject(auth);

      const configOverride = await project.getConfigOverride("branch");
      const filePath = path.resolve(opts.configFile);
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
    .requiredOption("--config-file <path>", "Path to config file (.js or .ts)")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);

      const filePath = path.resolve(opts.configFile);
      const ext = path.extname(filePath);

      if (ext !== ".js" && ext !== ".ts") {
        throw new CliError("Config file must have a .js or .ts extension.");
      }

      if (!fs.existsSync(filePath)) {
        throw new CliError(`Config file not found: ${filePath}`);
      }

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);
      const configModule: { config?: unknown } = await jiti.import(filePath);

      const config = configModule.config;
      if (!isConfigOverride(config)) {
        const examplePkg = detectImportPackageFromDir(path.dirname(filePath)) ?? "@stackframe/js";
        throw new CliError(`Config file must export a plain \`config\` object. Example: import type { StackConfig } from "${examplePkg}"; export const config: StackConfig = { ... };`);
      }

      const source = buildConfigPushSource(opts.configFile);

      if (isProjectAuthWithSecretServerKey(auth)) {
        await pushConfigWithSecretServerKey(auth, config, source);
      } else {
        if (!isProjectAuthWithRefreshToken(auth)) {
          throw new CliError("`stack config push` requires either STACK_SECRET_SERVER_KEY or `stack login`.");
        }
        const project = await getAdminProject(auth);
        await project.pushConfig(config, {
          source: sourceToSdkSource(source),
        });
      }

      console.log("Config pushed successfully.");
    });
}
