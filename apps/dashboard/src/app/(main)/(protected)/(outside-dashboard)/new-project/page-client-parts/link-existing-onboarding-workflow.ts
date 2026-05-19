export const WORKFLOW_FILE_NAME = "stack-auth-config-sync.yml";
export const WORKFLOW_FILE_PATH = `.github/workflows/${WORKFLOW_FILE_NAME}`;
export const GITHUB_PROJECT_ID_SECRET_NAME = "STACK_AUTH_PROJECT_ID";
export const GITHUB_SECRET_SERVER_KEY_SECRET_NAME = "STACK_AUTH_SECRET_SERVER_KEY";

function encodeYamlScalar(value: string): string {
  return JSON.stringify(value);
}

// GitHub Actions `on.push.paths` filters are repo-relative and do not match a
// leading `./`. Config-path suggestions and manual input may include one, so
// strip it to keep the push trigger (and the checked-out file path) canonical.
export function normalizeConfigPath(configPath: string): string {
  return configPath.trim().replace(/^(?:\.\/)+/, "");
}

export function buildWorkflowYaml(branch: string, configPath: string): string {
  const encodedBranch = encodeYamlScalar(branch);
  const encodedConfigPath = encodeYamlScalar(normalizeConfigPath(configPath));
  const encodedWorkflowPath = encodeYamlScalar(WORKFLOW_FILE_PATH);

  return `name: Stack Auth Config Sync

on:
  workflow_dispatch:
  push:
    branches:
      - ${encodedBranch}
    paths:
      - ${encodedConfigPath}
      - ${encodedWorkflowPath}

jobs:
  push-stack-config:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Push Stack Auth config
        env:
          STACK_PROJECT_ID: \${{ secrets.${GITHUB_PROJECT_ID_SECRET_NAME} }}
          STACK_SECRET_SERVER_KEY: \${{ secrets.${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} }}
          STACK_AUTH_CONFIG_PATH: ${encodedConfigPath}
        run: pnpx @stackframe/stack-cli@latest config push --cloud-project-id "$STACK_PROJECT_ID" --config-file "$STACK_AUTH_CONFIG_PATH"
`;
}
