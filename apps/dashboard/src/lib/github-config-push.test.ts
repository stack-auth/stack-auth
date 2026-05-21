import { describe, expect, it } from "vitest";
import { buildUpdatedConfigFileContent, pushConfigUpdateToGitHub } from "./github-config-push";

describe("buildUpdatedConfigFileContent", () => {
  it("merges a flat dot-notation update into the existing config", () => {
    const current = `import type { StackConfig } from "@stackframe/stack";

export const config: StackConfig = {
  teams: { allowClientTeamCreation: false },
};
`;
    const result = buildUpdatedConfigFileContent(current, { "teams.allowClientTeamCreation": true });
    expect(result).toContain('"teams": {');
    expect(result).toContain('"allowClientTeamCreation": true');
    expect(result).toContain('import type { StackConfig } from "@stackframe/stack"');
  });

  it("preserves the existing @stackframe/* import package when re-rendering", () => {
    const current = `import type { StackConfig } from "@stackframe/react";

export const config: StackConfig = {};
`;
    const result = buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true });
    expect(result).toContain('import type { StackConfig } from "@stackframe/react"');
  });

  it("defaults to @stackframe/js when no recognizable import is present", () => {
    const current = `export const config = {};\n`;
    const result = buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true });
    expect(result).toContain('import type { StackConfig } from "@stackframe/js"');
  });

  it("adds new top-level keys to an empty config", () => {
    const current = `import type { StackConfig } from "@stackframe/js";
export const config: StackConfig = {};
`;
    const result = buildUpdatedConfigFileContent(current, {
      "payments.items.todos.displayName": "Todos",
      "payments.items.todos.customerType": "user",
    });
    expect(result).toContain(`"payments": {
    "items": {
      "todos": {
        "displayName": "Todos",
        "customerType": "user"
      }
    }
  }`);
  });

  it("replaces an existing nested value via dot notation", () => {
    const current = `import type { StackConfig } from "@stackframe/js";
export const config: StackConfig = {
  payments: { items: { todos: { displayName: "Old" } } },
};
`;
    const result = buildUpdatedConfigFileContent(current, {
      "payments.items.todos.displayName": "New",
    });
    expect(result).toContain('"displayName": "New"');
    expect(result).not.toContain('"Old"');
  });

  it("refuses to mutate a show-onboarding placeholder file", () => {
    const current = `export const config = "show-onboarding";`;
    expect(() => buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true }))
      .toThrow(/onboarding placeholder/);
  });

  it("throws when the file does not export a `config` binding", () => {
    expect(() => buildUpdatedConfigFileContent(`export const other = {};`, { "a": 1 }))
      .toThrow(/must export a plain `config` object/);
  });
});

describe("pushConfigUpdateToGitHub", () => {
  function buildFakeFetch(initialContent: string) {
    const base64 = Buffer.from(initialContent, "utf-8").toString("base64");
    const calls: { path: string, init?: RequestInit }[] = [];
    const fn = async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (init?.method === "PUT") {
        return { commit: { sha: "newsha" } };
      }
      return {
        type: "file",
        encoding: "base64",
        content: base64,
        sha: "oldsha",
      };
    };
    return { fn, calls };
  }

  const baseSource = {
    type: "pushed-from-github" as const,
    owner: "myorg",
    repo: "my-repo",
    branch: "main",
    commitHash: "abc",
    configFilePath: "stack.config.ts",
  };

  it("fetches the existing file, merges the update, and PUTs the new content", async () => {
    const { fn, calls } = buildFakeFetch(`import type { StackConfig } from "@stackframe/js";
export const config: StackConfig = { teams: { allowClientTeamCreation: false } };
`);
    await pushConfigUpdateToGitHub({
      source: baseSource,
      configUpdate: { "teams.allowClientTeamCreation": true },
      commitMessage: "feat: enable team creation",
      githubFetch: fn,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe("/repos/myorg/my-repo/contents/stack.config.ts?ref=main");
    expect(calls[1].init?.method).toBe("PUT");
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.message).toBe("feat: enable team creation");
    expect(body.sha).toBe("oldsha");
    expect(body.branch).toBe("main");
    expect(Buffer.from(body.content, "base64").toString("utf-8")).toContain('"allowClientTeamCreation": true');
  });

  it("falls back to a default commit message when none is provided", async () => {
    const { fn, calls } = buildFakeFetch(`export const config = {};\n`);
    await pushConfigUpdateToGitHub({
      source: baseSource,
      configUpdate: { "auth.allowSignUp": true },
      commitMessage: "   ",
      githubFetch: fn,
    });
    const putBody = JSON.parse(String(calls[1].init?.body));
    expect(putBody.message).toBe("chore(stack-auth): update config from dashboard");
  });

  it("skips the commit when the new rendered file is identical to the old one", async () => {
    const same = `import type { StackConfig } from "@stackframe/js";

export const config: StackConfig = {
  "teams": {
    "allowClientTeamCreation": true
  }
};
`;
    const { fn, calls } = buildFakeFetch(same);
    await pushConfigUpdateToGitHub({
      source: baseSource,
      configUpdate: { "teams.allowClientTeamCreation": true },
      commitMessage: "no-op",
      githubFetch: fn,
    });
    expect(calls.find((c) => c.init?.method === "PUT")).toBeUndefined();
  });

  it("surfaces a clear error when the config file is missing on the branch", async () => {
    const fn = async () => {
      throw new Error("Not Found");
    };
    await expect(
      pushConfigUpdateToGitHub({
        source: baseSource,
        configUpdate: { "auth.allowSignUp": true },
        commitMessage: "x",
        githubFetch: fn,
      })
    ).rejects.toThrow(/Could not find stack\.config\.ts/);
  });

  it("propagates non-404 GitHub errors", async () => {
    const fn = async () => {
      throw new Error("Bad credentials");
    };
    await expect(
      pushConfigUpdateToGitHub({
        source: baseSource,
        configUpdate: { "auth.allowSignUp": true },
        commitMessage: "x",
        githubFetch: fn,
      })
    ).rejects.toThrow(/Bad credentials/);
  });
});
