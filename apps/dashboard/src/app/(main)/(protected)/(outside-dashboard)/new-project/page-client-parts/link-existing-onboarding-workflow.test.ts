import { describe, expect, it } from "vitest";

import {
  buildWorkflowYaml,
  GITHUB_PROJECT_ID_SECRET_NAME,
  GITHUB_SECRET_SERVER_KEY_SECRET_NAME,
  normalizeConfigPath,
  WORKFLOW_FILE_PATH,
} from "./link-existing-onboarding-workflow";

describe("buildWorkflowYaml", () => {
  it("encodes branch and config path scalars and uses env indirection in run command", () => {
    const branch = "main\"\n      - injected";
    const configPath = "stack.config.ts\"\n        run: echo hacked";
    const workflowYaml = buildWorkflowYaml(branch, configPath);

    expect(workflowYaml).toContain(`      - ${JSON.stringify(branch)}`);
    expect(workflowYaml).toContain(`      - ${JSON.stringify(configPath)}`);
    expect(workflowYaml).toContain(`      - ${JSON.stringify(WORKFLOW_FILE_PATH)}`);
    expect(workflowYaml).toContain(`          STACK_AUTH_CONFIG_PATH: ${JSON.stringify(configPath)}`);
    expect(workflowYaml).toContain(`          STACK_AUTH_SOURCE_REPO: \${{ github.repository }}`);
    expect(workflowYaml).toContain(`          STACK_AUTH_SOURCE_WORKFLOW_PATH: ${JSON.stringify(WORKFLOW_FILE_PATH)}`);
    expect(workflowYaml).toContain("run: npx --yes @hexclave/cli@latest config push --config-file \"$STACK_AUTH_CONFIG_PATH\" --source github --source-repo \"$STACK_AUTH_SOURCE_REPO\" --source-path \"$STACK_AUTH_CONFIG_PATH\" --source-workflow-path \"$STACK_AUTH_SOURCE_WORKFLOW_PATH\"");
    expect(workflowYaml).not.toContain(`--config-file "${configPath}"`);
  });

  it("keeps GitHub secret placeholders intact", () => {
    const workflowYaml = buildWorkflowYaml("main", "./stack.config.ts");

    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_PROJECT_ID_SECRET_NAME} }}`);
    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} }}`);
  });

  it("uses the GitHub Actions runtime repository context for --source-repo", () => {
    const workflowYaml = buildWorkflowYaml("main", "stack.config.ts");
    expect(workflowYaml).toContain("STACK_AUTH_SOURCE_REPO: ${{ github.repository }}");
    expect(workflowYaml).not.toMatch(/STACK_AUTH_SOURCE_REPO:\s+"[^$]/);
  });
});

describe("normalizeConfigPath", () => {
  it("strips a single leading ./", () => {
    expect(normalizeConfigPath("./stack.config.ts")).toBe("stack.config.ts");
  });

  it("strips repeated leading ./", () => {
    expect(normalizeConfigPath("././stack.config.ts")).toBe("stack.config.ts");
  });

  it("strips a mix of leading ./ and extra slashes", () => {
    expect(normalizeConfigPath(".//src/stack.config.ts")).toBe("src/stack.config.ts");
  });

  it("strips a single leading /", () => {
    expect(normalizeConfigPath("/src/stack.config.ts")).toBe("src/stack.config.ts");
  });

  it("leaves a repo-relative path alone", () => {
    expect(normalizeConfigPath("src/stack.config.ts")).toBe("src/stack.config.ts");
  });

  it("trims whitespace before normalization", () => {
    expect(normalizeConfigPath("  ./stack.config.ts  ")).toBe("stack.config.ts");
  });
});
