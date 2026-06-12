import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockAgentOptions = { prompt: string, cwd: string, onFileWillChange?: (filePath: string) => void | Promise<void> };
let mockAgentImpl: ((options: MockAgentOptions) => void | Promise<void>) | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@hexclave/shared-backend/config-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hexclave/shared-backend/config-agent")>();
  return {
    ...actual,
    runHeadlessClaudeAgent: async (options: { prompt: string, cwd: string, onPreToolUse?: (input: { hook_event_name: "PreToolUse", tool_name: string, tool_input: unknown }) => Promise<unknown> | unknown }) => {
      if (mockAgentImpl == null) {
        throw new Error("mockAgentImpl not set");
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

// Root temp config files next to this test file (inside apps/dashboard) rather
// than at process.cwd() (the repo root under vitest's workspace runner). This
// lets jiti resolve workspace packages like `@hexclave/next/config` the same
// way a real user project would — walking up to apps/dashboard/node_modules.
const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));

let tempDir: string | undefined;

function createTempDir(): string {
  tempDir ??= mkdtempSync(join(TEST_FILE_DIR, ".stack-rde-config-test-"));
  return tempDir;
}

function writeTempFile(name: string, content: string): string {
  const filePath = join(createTempDir(), name);
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

  it("throws a helpful error when the config file imports a module that fails to load", async () => {
    // Simulate a heavy framework package (e.g. @stackframe/stack) that throws on import
    const dir = createTempDir();
    const heavyPackagePath = join(dir, "heavy-package.ts");
    writeFileSync(heavyPackagePath, `throw new Error("Cannot load this in a Node.js context");`, "utf-8");
    const configPath = join(dir, "stack.config.ts");
    writeFileSync(configPath, `
      import "${heavyPackagePath}";
      export const config = {};
    `, "utf-8");

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).rejects.toThrow(
      `Failed to load config file ${configPath}. If your config imports a value (e.g. defineHexclaveConfig) from a framework package such as "@hexclave/next", import it from that package's lightweight "/config" entrypoint instead`
    );
  });

  it("rejects modules without a valid config export", async () => {
    const configPath = writeTempConfig(`
      export const config = () => ({ auth: { allowSignUp: true } });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).rejects.toThrow(`Invalid config in ${configPath}.`);
  });

  it("applies updates to a plain static config through the shared agent updater", async () => {
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

    mockAgentImpl = () => {
      writeFileSync(templatePath, "export default <div>New email</div>;\n", "utf-8");
    };

    await updateConfigObject(configPath, {
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    });

    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>New email</div>;\n");
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
  });

  it("can update config and imported text files in one shared agent run", async () => {
    const templatePath = writeTempFile("welcome-email.tsx", "export default <div>Old email</div>;\n");
    const configSource = `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  auth: { allowSignUp: true },\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`;
    const configPath = writeTempConfig(configSource);

    const { updateConfigObject } = await import("./config-file");

    mockAgentImpl = () => {
      writeFileSync(templatePath, "export default <div>New email</div>;\n", "utf-8");
      writeFileSync(configPath, `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  auth: { allowSignUp: false },\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`, "utf-8");
    };

    await updateConfigObject(configPath, {
      "auth.allowSignUp": false,
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    });

    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>New email</div>;\n");
    expect(readFileSync(configPath, "utf-8")).toBe(`import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  auth: { allowSignUp: false },\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`);
  });
});
