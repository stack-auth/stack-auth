/**
 * Pure logic for taking a config update produced by the dashboard, merging it
 * into the user's GitHub-stored `stack.config.ts` file, and committing the
 * result back to GitHub via the Contents API.
 *
 * `buildUpdatedConfigFileContent` is the pure heart of this module — it's
 * directly unit-testable, takes the current file content and a config update,
 * and returns the new file content. The orchestrator `pushConfigUpdateToGitHub`
 * wires it up to GitHub's REST API.
 */

import type { PushedConfigSource } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { isValidConfig, override } from "@hexclave/shared/dist/config/format";
import { parseStackConfigFileContent, renderConfigFileContent, showOnboardingStackConfigValue } from "@hexclave/shared/dist/hexclave-config-file";

import {
  commitFile,
  getFileContent,
  type GithubFetch,
} from "./github-api";

/**
 * Detects the `@hexclave/*` or legacy `@stackframe/*` import package used by
 * the existing config file so the re-rendered file keeps the same import
 * line. Falls back to `@hexclave/js` when the file is empty or the import
 * cannot be detected.
 */
function detectImportPackage(currentFileContent: string): string | undefined {
  // Match `from "@hexclave/<name>"` or `from "@stackframe/<name>"` — single
  // or double quotes. Hexclave preferred when both appear.
  const hexclave = currentFileContent.match(/from\s+["']@hexclave\/([a-z0-9-]+)["']/i);
  if (hexclave) return `@hexclave/${hexclave[1]}`;
  const stackframe = currentFileContent.match(/from\s+["']@stackframe\/([a-z0-9-]+)["']/i);
  return stackframe ? `@stackframe/${stackframe[1]}` : undefined;
}

/**
 * Pure: given the existing contents of a `stack.config.ts` file and a config
 * update (the same dot-notation override shape that flows through
 * `updatePushedConfig`), returns the new file contents.
 *
 * The existing import line is preserved when the source file imports
 * `StackConfig` from a known `@hexclave/*` or legacy `@stackframe/*` package;
 * otherwise the renderer uses its own default.
 */
export function buildUpdatedConfigFileContent(
  currentFileContent: string,
  configUpdate: EnvironmentConfigOverrideOverride,
): string {
  const parsed = parseStackConfigFileContent(currentFileContent, "stack.config.ts");
  if (parsed === showOnboardingStackConfigValue) {
    throw new Error(
      "The config file currently exports the onboarding placeholder. Finish setting up Hexclave in your repo before pushing dashboard changes."
    );
  }
  if (!isValidConfig(parsed)) {
    throw new Error("Existing GitHub config file does not parse as a valid Hexclave config object.");
  }
  const merged = override(parsed, configUpdate);
  const importPackage = detectImportPackage(currentFileContent);
  return renderConfigFileContent(merged, importPackage);
}

export type PushConfigUpdateOptions = {
  source: Extract<PushedConfigSource, { type: "pushed-from-github" }>,
  configUpdate: EnvironmentConfigOverrideOverride,
  commitMessage: string,
  githubFetch: GithubFetch,
};

/**
 * Pushes a config update to GitHub by editing the user's `stack.config.ts`
 * file in place via the Contents API. The accompanying GitHub Actions workflow
 * (added in onboarding) will pick up the commit and re-push the canonical
 * config back to Hexclave.
 *
 * Commits the updated config file when needed; returns once GitHub accepts the
 * write.
 */
export async function pushConfigUpdateToGitHub(options: PushConfigUpdateOptions): Promise<void> {
  const { source, configUpdate, commitMessage, githubFetch } = options;
  const { owner, repo, branch, configFilePath } = source;

  const existing = await getFileContent(githubFetch, { owner, repo, branch, path: configFilePath });
  if (existing == null) {
    throw new Error(
      `Could not find ${configFilePath} on ${owner}/${repo}@${branch}. Check that the config file still exists in the linked branch.`
    );
  }

  const newContent = buildUpdatedConfigFileContent(existing.text, configUpdate);
  if (newContent === existing.text) {
    // Nothing changed in the rendered file — no need to commit. The dashboard
    // will still update the cloud-side override for immediate feedback.
    return;
  }

  const trimmedMessage = commitMessage.trim().length > 0
    ? commitMessage.trim()
    : "chore(stack-auth): update config from dashboard";

  await commitFile(githubFetch, {
    owner,
    repo,
    branch,
    path: configFilePath,
    content: newContent,
    message: trimmedMessage,
    sha: existing.sha,
  });
}
