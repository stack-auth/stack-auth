export const WORKFLOW_FILE_NAME = "hexclave-config-sync.yml";
export const WORKFLOW_FILE_PATH = `.github/workflows/${WORKFLOW_FILE_NAME}`;
export const GITHUB_PROJECT_ID_SECRET_NAME = "HEXCLAVE_PROJECT_ID";
export const GITHUB_SECRET_SERVER_KEY_SECRET_NAME = "HEXCLAVE_SECRET_SERVER_KEY";

function encodeYamlScalar(value: string): string {
  return JSON.stringify(value);
}

// GitHub Actions `on.push.paths` filters are repo-relative and do not match a
// leading `./` or `/`. Config-path suggestions and manual input may include
// either, possibly repeated (e.g. `.//src/...`), so strip any combination of
// leading `./` and `/` segments to keep the push trigger and checked-out path
// canonical.
export function normalizeConfigPath(configPath: string): string {
  return configPath.trim().replace(/^(?:\.?\/+)+/, "");
}

export function buildWorkflowYaml(branch: string, configPath: string): string {
  const encodedBranch = encodeYamlScalar(branch);
  const normalizedConfigPath = normalizeConfigPath(configPath);
  if (normalizedConfigPath.length === 0) {
    throw new Error("Expected a non-empty config path after normalization (input must not be blank or only './').");
  }
  const encodedConfigPath = encodeYamlScalar(normalizedConfigPath);
  const encodedWorkflowPath = encodeYamlScalar(WORKFLOW_FILE_PATH);

  // `actions/checkout` lands the repo at the runner cwd, so `$STACK_AUTH_CONFIG_PATH`
  // (repo-relative) is also the local path on disk — that's why the same env var is
  // safe to use for both `--config-file` and `--source-path`. If a future workflow
  // checks out with `with: path: <subdir>`, these would diverge.
  return `name: Hexclave Config Sync

on:
  workflow_dispatch:
  push:
    branches:
      - ${encodedBranch}
    paths:
      - ${encodedConfigPath}
      - ${encodedWorkflowPath}

jobs:
  push-hexclave-config:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "20"
      - name: Push Hexclave config
        env:
          HEXCLAVE_PROJECT_ID: \${{ secrets.${GITHUB_PROJECT_ID_SECRET_NAME} }}
          HEXCLAVE_SECRET_SERVER_KEY: \${{ secrets.${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} }}
          HEXCLAVE_CONFIG_PATH: ${encodedConfigPath}
          HEXCLAVE_SOURCE_REPO: \${{ github.repository }}
          HEXCLAVE_SOURCE_WORKFLOW_PATH: ${encodedWorkflowPath}
        run: npx --yes @hexclave/cli@latest config push --config-file "$HEXCLAVE_CONFIG_PATH" --source github --source-repo "$HEXCLAVE_SOURCE_REPO" --source-path "$HEXCLAVE_CONFIG_PATH" --source-workflow-path "$HEXCLAVE_SOURCE_WORKFLOW_PATH"
`;
}
