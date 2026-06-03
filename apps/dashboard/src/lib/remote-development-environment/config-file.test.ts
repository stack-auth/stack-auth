import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lets each AI-path test inject what the (otherwise network-backed) agent does
// to the files on disk, so we can exercise the orchestration and validation
// around `updateConfigObject` without calling a real model.
type MockAgentOptions = { prompt: string, cwd: string, onFileWillChange?: (filePath: string) => void | Promise<void> };
let mockAgentImpl: ((options: MockAgentOptions) => void | Promise<void>) | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@hexclave/local-config-updater/config-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hexclave/local-config-updater/config-agent")>();
  return {
    ...actual,
    runHeadlessClaudeAgent: async (options: { prompt: string, cwd: string, onPreToolUse?: (input: { hook_event_name: "PreToolUse", tool_name: string, tool_input: unknown }) => Promise<unknown> | unknown }) => {
      if (mockAgentImpl == null) {
        throw new Error("runHeadlessClaudeAgent was called but no mock implementation was set for this test.");
      }
      await mockAgentImpl({
        prompt: options.prompt,
        cwd: options.cwd,
        onFileWillChange: async (filePath) => {
          await options.onPreToolUse?.({
            hook_event_name: "PreToolUse",
            tool_name: "Write",
            tool_input: { file_path: filePath },
          });
        },
      });
      return { resultText: "done" };
    },
  };
});

let tempDir: string | undefined;

function getTempDir(): string {
  if (tempDir == null) {
    tempDir = mkdtempSync(join(process.cwd(), ".stack-rde-config-test-"));
    // Give the temp dir its own package.json so SDK-package detection (which
    // walks up to the nearest package.json) resolves deterministically here
    // instead of picking up the dashboard's own dependencies, which would make
    // the rendered `StackConfig` import env-dependent.
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "stack-rde-config-test" }), "utf-8");
  }
  return tempDir;
}

function writeTempFile(name: string, content: string): string {
  const filePath = join(getTempDir(), name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function writeTempConfig(content: string): string {
  return writeTempFile("stack.config.ts", content);
}

afterEach(() => {
  vi.resetModules();
  mockAgentImpl = null;
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("remote development environment config file", () => {
  it("loads config exports wrapped in defineStackConfig", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";

      export const config = defineStackConfig({
        auth: {
          allowSignUp: true,
        },
      });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("loads config exports wrapped in defineHexclaveConfig", async () => {
    const configPath = writeTempConfig(`
      import { defineHexclaveConfig } from "@hexclave/shared/config";

      export const config = defineHexclaveConfig({
        auth: {
          allowSignUp: false,
        },
      });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("loads config exports produced by TypeScript function calls", async () => {
    const configPath = writeTempConfig(`
      function makeConfig() {
        return {
          auth: {
            allowSignUp: true,
          },
        };
      }

      export const config = makeConfig();
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("reloads the config module after the file changes", async () => {
    const configPath = writeTempConfig(`
      export const config = {
        auth: {
          allowSignUp: true,
        },
      };
    `);
    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);

    writeFileSync(configPath, `
      export const config = {
        auth: {
          allowSignUp: false,
        },
      };
    `, "utf-8");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("treats the onboarding placeholder as an empty config", async () => {
    const configPath = writeTempConfig(`
      export const config = "show-onboarding";
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {},
        "showOnboarding": true,
      }
    `);
  });

  it("rejects modules without a valid config export", async () => {
    const configPath = writeTempConfig(`
      export const config = () => ({ auth: { allowSignUp: true } });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).rejects.toThrow(`Invalid config in ${configPath}.`);
  });

  it("applies updates to a plain static config through the agent", async () => {
    const configPath = writeTempConfig(`
      export const config = {
        auth: {
          allowSignUp: false,
        },
      };
    `);
    const { readConfigFile, updateConfigObject } = await import("./config-file");

    mockAgentImpl = () => {
      writeFileSync(configPath, `
        export const config = {
          auth: {
            allowSignUp: false,
          },
          payments: {
            testMode: true,
          },
        };
      `, "utf-8");
    };

    await updateConfigObject(configPath, {
      "payments.testMode": true,
    });

    expect(readFileSync(configPath, "utf-8")).toContain("payments");
    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
          "payments": {
            "testMode": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("updates the externally-referenced file instead of inlining or overwriting the config", async () => {
    const templatePath = writeTempFile("welcome-email.tsx", "export default <div>Old email</div>;\n");
    const configSource = `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`;
    const configPath = writeTempConfig(configSource);

    const { updateConfigObject } = await import("./config-file");

    // Simulate the agent: write the new value into the referenced file and leave
    // the config file untouched.
    mockAgentImpl = () => {
      writeFileSync(templatePath, "export default <div>New email</div>;\n", "utf-8");
    };

    await updateConfigObject(configPath, {
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    });

    // The external file is updated and the config file keeps its import + shape.
    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>New email</div>;\n");
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
  });

  it("validates the result semantically when the config is evaluable", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";
      export const config = defineStackConfig({
        auth: { allowSignUp: true },
      });
    `);
    const { readConfigFile, updateConfigObject } = await import("./config-file");

    mockAgentImpl = () => {
      writeFileSync(configPath, `
        import { defineStackConfig } from "@hexclave/shared/config";
        export const config = defineStackConfig({
          auth: { allowSignUp: false },
        });
      `, "utf-8");
    };

    await updateConfigObject(configPath, { "auth.allowSignUp": false });

    // The defineStackConfig wrapper is preserved and the value is updated.
    expect(readFileSync(configPath, "utf-8")).toContain("defineStackConfig");
    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("throws when the agent produces a config that does not match the requested update", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";
      export const config = defineStackConfig({
        auth: { allowSignUp: true },
      });
    `);
    const { updateConfigObject } = await import("./config-file");

    // The agent writes the wrong value (allowSignUp stays true).
    mockAgentImpl = () => {
      writeFileSync(configPath, `
        import { defineStackConfig } from "@hexclave/shared/config";
        export const config = defineStackConfig({
          auth: { allowSignUp: true },
        });
      `, "utf-8");
    };

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false }))
      .rejects.toThrow(/validation failed/);
  });

  it("rolls back the config and its referenced files when the agent's result fails validation", async () => {
    const templatePath = writeTempFile("welcome-email.tsx", "export default <div>Old email</div>;\n");
    const configSource = `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`;
    const configPath = writeTempConfig(configSource);

    const { updateConfigObject } = await import("./config-file");

    // The agent edits both files but then fails, so the partially-applied edits
    // must be rolled back and the failure surfaced.
    mockAgentImpl = () => {
      writeFileSync(templatePath, "export default <div>Corrupted</div>;\n", "utf-8");
      writeFileSync(configPath, `export const config = { auth: { allowSignUp: true } };\n`, "utf-8");
      throw new Error("agent blew up");
    };

    await expect(updateConfigObject(configPath, {
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    })).rejects.toThrow("agent blew up");

    // Both the config file and the externally-referenced file are back to their
    // original contents \u2014 no half-applied update is left behind.
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>Old email</div>;\n");
  });

  it("rolls back a brand-new file the agent creates outside the statically-imported set", async () => {
    // A wrapped config takes the agent path (it isn't a plain static literal),
    // so the agent mock actually runs.
    const configSource = `import { defineStackConfig } from "@hexclave/shared/config";\nexport const config = defineStackConfig({ auth: { allowSignUp: true } });\n`;
    const configPath = writeTempConfig(configSource);
    const newFilePath = join(getTempDir(), "generated-extra.ts");

    const { updateConfigObject } = await import("./config-file");

    // The agent creates a file that the config doesn't statically import, so the
    // only way it can be rolled back is via the `onFileWillChange` hook firing
    // before the write. After creating it, the agent fails so the run must roll
    // back — deleting the newly-created file.
    mockAgentImpl = async (options) => {
      await options.onFileWillChange?.(newFilePath);
      writeFileSync(newFilePath, "export const extra = true;\n", "utf-8");
      throw new Error("agent blew up");
    };

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false }))
      .rejects.toThrow("agent blew up");

    expect(existsSync(newFilePath)).toBe(false);
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
  });

  it("fails a non-evaluable update when the agent leaves every file unchanged", async () => {
    const templatePath = writeTempFile("welcome-email.tsx", "export default <div>Old email</div>;\n");
    const configSource = `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`;
    const configPath = writeTempConfig(configSource);

    const { updateConfigObject } = await import("./config-file");

    // The agent reports success but doesn't actually touch any file. Since this
    // config isn't evaluable, we can't do a semantic check, but a no-op for a
    // non-empty update must still be reported as a failure rather than silently
    // succeeding.
    mockAgentImpl = () => {};

    await expect(updateConfigObject(configPath, {
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    })).rejects.toThrow(/did not modify/);

    // The files are untouched (a no-op restored to its identical original).
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>Old email</div>;\n");
  });
});
