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

// Config with an import triggers the agent path (tryParseHexclaveConfigFileContent returns null)
const CUSTOM_CONFIG = `import emailHtml from "./emails/welcome.html" with { type: "text" };
export const config = { auth: { allowSignUp: true }, emails: { welcomeHtml: emailHtml } };
`;

describe("local config updater fast path", () => {
  it("uses the fast path for plain static configs (no agent invoked)", async () => {
    const configPath = writeTempConfig("export const config = { auth: { allowSignUp: true } };\n");
    mockScriptedWrites = [{ tool_name: "Write", file_path: path.join(getTempDir(), "x.ts") }];

    const { updateConfigObject } = await import("./index");

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false })).resolves.toBeUndefined();

    // Agent was never called, so no hook decisions were recorded
    expect(mockHookDecisions).toEqual([]);
    // The config file was updated deterministically
    expect(readFileSync(configPath, "utf-8")).toContain('"allowSignUp": false');
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
