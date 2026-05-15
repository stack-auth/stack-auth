import { describe, expect, it } from "vitest";

import {
  buildWorkflowYaml,
  GITHUB_PROJECT_ID_SECRET_NAME,
  GITHUB_SECRET_SERVER_KEY_SECRET_NAME,
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
    expect(workflowYaml).toContain("run: pnpx @stackframe/stack-cli@latest config push --config-file \"$STACK_AUTH_CONFIG_PATH\"");
    expect(workflowYaml).not.toContain(`--config-file "${configPath}"`);
  });

  it("keeps GitHub secret placeholders intact", () => {
    const workflowYaml = buildWorkflowYaml("main", "./stack.config.ts");

    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_PROJECT_ID_SECRET_NAME} }}`);
    expect(workflowYaml).toContain(`\${{ secrets.${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} }}`);
  });
});
