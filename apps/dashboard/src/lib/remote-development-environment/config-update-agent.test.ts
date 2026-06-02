import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real PreToolUse hook without a network-backed model: each scripted
// write is fed through the hook the same way the SDK would before a Write/Edit,
// so we can assert the agent's writes stay confined to the config directory.
type MockToolWrite = { tool_name: string, file_path: string };
let mockScriptedWrites: MockToolWrite[] = [];
let mockHookDecisions: unknown[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: { hooks?: { PreToolUse?: { hooks: ((input: unknown) => Promise<unknown>)[] }[] } } }) =>
    (async function* () {
      const hook = options.hooks?.PreToolUse?.[0]?.hooks?.[0] ?? null;
      for (const write of mockScriptedWrites) {
        const decision = hook == null
          ? null
          : await hook({ hook_event_name: "PreToolUse", tool_name: write.tool_name, tool_input: { file_path: write.file_path } });
        mockHookDecisions.push(decision);
      }
      yield { type: "result", result: "done" };
    })(),
}));

import { runConfigUpdateAgent } from "./config-update-agent";

beforeEach(() => {
  mockScriptedWrites = [];
  mockHookDecisions = [];
});

describe("runConfigUpdateAgent write boundary", () => {
  const cwd = path.resolve("/tmp/stack-rde-agent-boundary-test");

  it("allows writes inside the config directory and captures them for rollback", async () => {
    const inside = path.join(cwd, "emails", "welcome-email.tsx");
    mockScriptedWrites = [{ tool_name: "Write", file_path: inside }];
    const captured: string[] = [];

    await expect(runConfigUpdateAgent({ prompt: "apply", cwd, onFileWillChange: (p) => captured.push(p) })).resolves.toBeUndefined();

    expect(captured).toEqual([inside]);
    expect(mockHookDecisions).toEqual([{ continue: true }]);
  });

  it("denies a `../` escape, fails the run, and never snapshots the escaping file", async () => {
    const outside = path.resolve(cwd, "../../.env");
    mockScriptedWrites = [{ tool_name: "Write", file_path: outside }];
    const captured: string[] = [];

    await expect(
      runConfigUpdateAgent({ prompt: "apply", cwd, onFileWillChange: (p) => captured.push(p) }),
    ).rejects.toThrow(/outside the config directory/);

    expect(captured).toEqual([]);
    expect(mockHookDecisions).toHaveLength(1);
    expect(mockHookDecisions[0]).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  it("denies an absolute path outside the config directory", async () => {
    mockScriptedWrites = [{ tool_name: "Edit", file_path: "/etc/passwd" }];

    await expect(
      runConfigUpdateAgent({ prompt: "apply", cwd, onFileWillChange: () => {} }),
    ).rejects.toThrow("/etc/passwd");
  });
});
