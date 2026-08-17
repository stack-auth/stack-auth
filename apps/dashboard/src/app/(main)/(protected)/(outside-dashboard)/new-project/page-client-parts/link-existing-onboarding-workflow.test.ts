import { describe, expect, it } from "vitest";

import {
  buildGithubWorkflowAiPrompt,
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
    expect(workflowYaml).toContain(`          HEXCLAVE_CONFIG_PATH: ${JSON.stringify(configPath)}`);
    expect(workflowYaml).toContain(`          HEXCLAVE_SOURCE_REPO: \${{ github.repository }}`);
    expect(workflowYaml).toContain(`          HEXCLAVE_SOURCE_WORKFLOW_PATH: ${JSON.stringify(WORKFLOW_FILE_PATH)}`);
    expect(workflowYaml).toContain("run: npx --yes @hexclave/cli@latest config push --config-file \"$HEXCLAVE_CONFIG_PATH\" --source github --source-repo \"$HEXCLAVE_SOURCE_REPO\" --source-path \"$HEXCLAVE_CONFIG_PATH\" --source-workflow-path \"$HEXCLAVE_SOURCE_WORKFLOW_PATH\"");
    expect(workflowYaml).not.toContain(`--config-file "${configPath}"`);
  });

  it("keeps GitHub secret placeholders intact", () => {
    const workflowYaml = buildWorkflowYaml("main", "./stack.config.ts");

    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_PROJECT_ID_SECRET_NAME} }}`);
    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} }}`);
  });

  it("uses the GitHub Actions runtime repository context for --source-repo", () => {
    const workflowYaml = buildWorkflowYaml("main", "hexclave.config.ts");
    expect(workflowYaml).toContain("HEXCLAVE_SOURCE_REPO: ${{ github.repository }}");
    expect(workflowYaml).not.toMatch(/HEXCLAVE_SOURCE_REPO:\s+"[^$]/);
  });

  it("installs the repo's dependencies (with lockfile detection) before pushing config", () => {
    const workflowYaml = buildWorkflowYaml("main", "hexclave.config.ts");
    expect(workflowYaml).toContain("- name: Install dependencies");
    for (const marker of ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm ci"]) {
      expect(workflowYaml).toContain(marker);
    }
    // The install must run before the push step, otherwise the SDK import would
    // still be unresolvable when the CLI evaluates the config.
    expect(workflowYaml.indexOf("- name: Install dependencies")).toBeLessThan(
      workflowYaml.indexOf("- name: Push Hexclave config"),
    );
  });
});

describe("buildGithubWorkflowAiPrompt", () => {
  it("asks the agent to invent branch/config paths, includes an example workflow, and appends reminders", () => {
    const reminders = "HEXCLAVE_REMINDERS_BLOCK";
    const prompt = buildGithubWorkflowAiPrompt({ reminders });

    expect(prompt).toContain(WORKFLOW_FILE_PATH);
    expect(prompt).toContain(GITHUB_PROJECT_ID_SECRET_NAME);
    expect(prompt).toContain(GITHUB_SECRET_SERVER_KEY_SECRET_NAME);
    expect(prompt).toContain("Do not ask me for those values");
    expect(prompt).toContain("config push");
    expect(prompt).toContain("```yaml");
    expect(prompt).toContain("name: Hexclave Config Sync");
    expect(prompt).toContain(reminders);
    expect(prompt).not.toContain("Choose the workflow paths");
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
