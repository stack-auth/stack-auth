import { describe, expect, it } from "vitest";
import { buildCompleteConfigAgentPrompt, buildPartialConfigAgentPrompt, CONFIG_AGENT_FILE_TOOLS, CONFIG_AGENT_REPO_TOOLS } from "./config-agent";

describe("config agent prompt", () => {
  it("uses the same core rules for complete repo edits", () => {
    expect(buildCompleteConfigAgentPrompt({
      scope: { mode: "repo" },
      completeConfig: { auth: { allowSignUp: false } },
      commandPolicy: "Do not run builds.",
    })).toMatchInlineSnapshot(`
      "You are updating a Hexclave / Stack Auth configuration file.

      Current working directory: the repository root. Find the Hexclave / Stack Auth config file. It is usually a \`*.config.ts\` file exporting \`config\`, often wrapped in \`defineHexclaveConfig(...)\` or a similar helper.

      The exported config must end up deep-equal to this JSON value:

      {
        "auth": {
          "allowSignUp": false
        }
      }

      Rules:
      - Keep the file valid: it must still export \`config\`.
      - Preserve the existing authoring style where possible: imports, comments, helper wrappers, file header comments, and formatting.
      - If the config currently exports the placeholder string "show-onboarding" or is otherwise a stub, replace it with a real typed config object.
      - If a config value is conventionally sourced from an imported external file, you may keep that indirection as long as the evaluated config matches the requested value.
      - Do not touch unrelated files or application code.
      - Do not run builds.
      - Make the edits, then stop."
    `);
  });

  it("supports partial known-file edits for unevaluable local configs", () => {
    expect(buildPartialConfigAgentPrompt({
      configFileName: "hexclave.config.ts",
      changes: [{ path: "auth.allowSignUp", value: false }],
      commandPolicy: "Do not run shell commands.",
    })).toContain(`- "auth.allowSignUp": set to false`);
  });

  it("keeps repo tools as the file tools plus Bash", () => {
    expect(CONFIG_AGENT_REPO_TOOLS).toEqual([...CONFIG_AGENT_FILE_TOOLS, "Bash"]);
  });
});
