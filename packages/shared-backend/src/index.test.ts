import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockToolWrite = { tool_name: string, file_path: string };
let mockScriptedWrites: MockToolWrite[] = [];
let mockHookDecisions: unknown[] = [];
let mockAfterWrites: (() => void) | null = null;
let tempDir: string | undefined;

vi.mock("./config-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config-agent")>();
  return {
    ...actual,
    runHeadlessClaudeAgent: async (options: {
      cwd: string,
      onPreToolUse?: (input: { hook_event_name: "PreToolUse", tool_name: string, tool_input: unknown }) => Promise<unknown> | unknown,
    }) => {
      for (const write of mockScriptedWrites) {
        const decision = await options.onPreToolUse?.({
          hook_event_name: "PreToolUse",
          tool_name: write.tool_name,
          tool_input: { file_path: write.file_path },
        });
        mockHookDecisions.push(decision);
      }
      mockAfterWrites?.();
      return { resultText: "done" };
    },
  };
});

function getTempDir(): string {
  if (tempDir == null) {
    tempDir = mkdtempSync(path.join(process.cwd(), ".shared-backend-test-"));
    writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "shared-backend-test" }), "utf-8");
  }
  return tempDir;
}

function writeTempConfig(content: string): string {
  const configPath = path.join(getTempDir(), "stack.config.ts");
  writeFileSync(configPath, content, "utf-8");
  return configPath;
}

beforeEach(() => {
  mockScriptedWrites = [];
  mockHookDecisions = [];
  mockAfterWrites = null;
});

afterEach(() => {
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

// Config with an unresolvable import — jiti can't evaluate it, so validation
// falls back to the structural check.
const CUSTOM_CONFIG = `import emailHtml from "./emails/welcome.html" with { type: "text" };
export const config = { auth: { allowSignUp: true }, emails: { welcomeHtml: emailHtml } };
`;

describe("local config updater always uses the agent (no deterministic fast path)", () => {
  it("routes even a plain static config through the agent", async () => {
    // A plain object literal could be re-rendered deterministically, but we
    // deliberately don't: every write goes through the agent so authoring is
    // preserved. The agent (mocked) must therefore be invoked here.
    const configPath = writeTempConfig("export const config = { auth: { allowSignUp: true } };\n");
    mockScriptedWrites = [{ tool_name: "Edit", file_path: configPath }];
    mockAfterWrites = () => {
      writeFileSync(configPath, "export const config = { auth: { allowSignUp: false } };\n", "utf-8");
    };

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false })).resolves.toBeUndefined();

    expect(mockHookDecisions).toEqual([{ continue: true }]);
    expect(readFileSync(configPath, "utf-8")).toContain("allowSignUp: false");
  });

  it("preserves a helper-wrapped config's authoring when applying an update", async () => {
    // A local helper avoids depending on `@hexclave/next` resolving in the temp dir.
    const wrapped = `function defineConfig(c) { return c; }\nexport const config = defineConfig({ auth: { allowSignUp: true } });\n`;
    const configPath = writeTempConfig(wrapped);
    mockScriptedWrites = [{ tool_name: "Edit", file_path: configPath }];
    mockAfterWrites = () => {
      // The real agent edits in place, preserving the helper wrapper.
      writeFileSync(configPath, `function defineConfig(c) { return c; }\nexport const config = defineConfig({ auth: { allowSignUp: false } });\n`, "utf-8");
    };

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false })).resolves.toBeUndefined();

    expect(mockHookDecisions).toEqual([{ continue: true }]);
    // The helper wrapper survived — the file was NOT replaced by a rendered blob.
    const result = readFileSync(configPath, "utf-8");
    expect(result).toContain("defineConfig(");
    expect(result).toContain("allowSignUp: false");
  });
});

describe("local config updater agent write boundary", () => {
  it("allows writes inside the config directory and captures them for rollback", async () => {
    const configPath = writeTempConfig(CUSTOM_CONFIG);
    const inside = path.join(getTempDir(), "emails", "welcome-email.tsx");
    mockScriptedWrites = [{ tool_name: "Write", file_path: inside }];
    mockAfterWrites = () => {
      writeFileSync(configPath, "export const config = { auth: { allowSignUp: false } };\n", "utf-8");
    };

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false })).resolves.toBeUndefined();

    expect(mockHookDecisions).toEqual([{ continue: true }]);
  });

  it("denies a `../` escape and fails the run", async () => {
    const configPath = writeTempConfig(CUSTOM_CONFIG);
    const outside = path.resolve(getTempDir(), "../../.env");
    mockScriptedWrites = [{ tool_name: "Write", file_path: outside }];

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false }))
      .rejects.toThrow(/outside the config directory/);

    expect(mockHookDecisions).toHaveLength(1);
    expect(mockHookDecisions[0]).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
    expect(readFileSync(configPath, "utf-8")).toBe(CUSTOM_CONFIG);
  });

  it("denies an absolute path outside the config directory", async () => {
    const configPath = writeTempConfig(CUSTOM_CONFIG);
    mockScriptedWrites = [{ tool_name: "Edit", file_path: "/etc/passwd" }];

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false }))
      .rejects.toThrow("/etc/passwd");
  });
});
