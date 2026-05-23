import { describe, expect, it } from "vitest";
import { isObject } from "./github-api";
import { buildUpdatedConfigFileContent, pushConfigUpdateToGitHub } from "./github-config-push";

function getStringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`Expected request body field ${key} to be a string.`);
  }
  return field;
}

function snapshotGithubCall(call: { path: string, init?: RequestInit }) {
  if (call.init == null) {
    return { path: call.path };
  }
  const body = call.init.body;
  if (body == null) {
    return {
      path: call.path,
      init: call.init,
    };
  }
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  const parsedBody: unknown = JSON.parse(body);
  if (!isObject(parsedBody)) {
    throw new Error("Expected request body to parse as an object.");
  }
  const content = getStringField(parsedBody, "content");
  return {
    path: call.path,
    method: call.init.method,
    headers: call.init.headers,
    body: {
      ...parsedBody,
      content: Buffer.from(content, "base64").toString("utf-8"),
    },
  };
}

describe("buildUpdatedConfigFileContent", () => {
  it("merges a flat dot-notation update into the existing config", () => {
    const current = `import type { StackConfig } from "@hexclave/next";

export const config: StackConfig = {
  teams: { allowClientTeamCreation: false },
};
`;
    const result = buildUpdatedConfigFileContent(current, { "teams.allowClientTeamCreation": true });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/next";

      export const config: StackConfig = {
        "teams": {
          "allowClientTeamCreation": true
        }
      };
      "
    `);
  });

  it("preserves the existing @hexclave/* import package when re-rendering", () => {
    const current = `import type { StackConfig } from "@hexclave/react";

export const config: StackConfig = {};
`;
    const result = buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/react";

      export const config: StackConfig = {
        "auth": {
          "allowSignUp": true
        }
      };
      "
    `);
  });

  it("preserves a legacy @stackframe/* import package when re-rendering", () => {
    // Projects pinned to the last @stackframe/* release (before the Hexclave
    // rebrand) still have config files importing from the legacy scope. The
    // dashboard must not silently rewrite their imports — keep what's there.
    const current = `import type { StackConfig } from "@stackframe/react";

export const config: StackConfig = {};
`;
    const result = buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@stackframe/react";

      export const config: StackConfig = {
        "auth": {
          "allowSignUp": true
        }
      };
      "
    `);
  });

  it("defaults to @hexclave/js when no recognizable import is present", () => {
    const current = `export const config = {};\n`;
    const result = buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "auth": {
          "allowSignUp": true
        }
      };
      "
    `);
  });

  it("adds new top-level keys to an empty config", () => {
    const current = `import type { StackConfig } from "@hexclave/js";
export const config: StackConfig = {};
`;
    const result = buildUpdatedConfigFileContent(current, {
      "payments.items.todos.displayName": "Todos",
      "payments.items.todos.customerType": "user",
    });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "payments": {
          "items": {
            "todos": {
              "displayName": "Todos",
              "customerType": "user"
            }
          }
        }
      };
      "
    `);
  });

  it("replaces an existing nested value via dot notation", () => {
    const current = `import type { StackConfig } from "@hexclave/js";
export const config: StackConfig = {
  payments: { items: { todos: { displayName: "Old" } } },
};
`;
    const result = buildUpdatedConfigFileContent(current, {
      "payments.items.todos.displayName": "New",
    });
    expect(result).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "payments": {
          "items": {
            "todos": {
              "displayName": "New"
            }
          }
        }
      };
      "
    `);
  });

  it("refuses to mutate a show-onboarding placeholder file", () => {
    const current = `export const config = "show-onboarding";`;
    expect(() => buildUpdatedConfigFileContent(current, { "auth.allowSignUp": true }))
      .toThrowErrorMatchingInlineSnapshot(`[Error: The config file currently exports the onboarding placeholder. Finish setting up Hexclave in your repo before pushing dashboard changes.]`);
  });

  it("throws when the file does not export a `config` binding", () => {
    expect(() => buildUpdatedConfigFileContent(`export const other = {};`, { "a": 1 }))
      .toThrowErrorMatchingInlineSnapshot(`[Error: Invalid config in stack.config.ts. The file must export a plain \`config\` object or "show-onboarding".]`);
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
    const { fn, calls } = buildFakeFetch(`import type { StackConfig } from "@hexclave/js";
export const config: StackConfig = { teams: { allowClientTeamCreation: false } };
`);
    await pushConfigUpdateToGitHub({
      source: baseSource,
      configUpdate: { "teams.allowClientTeamCreation": true },
      commitMessage: "feat: enable team creation",
      githubFetch: fn,
    });
    expect(calls.map(snapshotGithubCall)).toMatchInlineSnapshot(`
      [
        {
          "init": {
            "cache": "no-store",
          },
          "path": "/repos/myorg/my-repo/contents/stack.config.ts?ref=main",
        },
        {
          "body": {
            "branch": "main",
            "content": "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "teams": {
          "allowClientTeamCreation": true
        }
      };
      ",
            "message": "feat: enable team creation",
            "sha": "oldsha",
          },
          "headers": {
            "content-type": "application/json",
          },
          "method": "PUT",
          "path": "/repos/myorg/my-repo/contents/stack.config.ts",
        },
      ]
    `);
  });

  it("falls back to a default commit message when none is provided", async () => {
    const { fn, calls } = buildFakeFetch(`export const config = {};\n`);
    await pushConfigUpdateToGitHub({
      source: baseSource,
      configUpdate: { "auth.allowSignUp": true },
      commitMessage: "   ",
      githubFetch: fn,
    });
    expect(calls.map(snapshotGithubCall)).toMatchInlineSnapshot(`
      [
        {
          "init": {
            "cache": "no-store",
          },
          "path": "/repos/myorg/my-repo/contents/stack.config.ts?ref=main",
        },
        {
          "body": {
            "branch": "main",
            "content": "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "auth": {
          "allowSignUp": true
        }
      };
      ",
            "message": "chore(stack-auth): update config from dashboard",
            "sha": "oldsha",
          },
          "headers": {
            "content-type": "application/json",
          },
          "method": "PUT",
          "path": "/repos/myorg/my-repo/contents/stack.config.ts",
        },
      ]
    `);
  });

  it("skips the commit when the new rendered file is identical to the old one", async () => {
    const same = `import type { StackConfig } from "@hexclave/js";

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
    expect(calls.map(snapshotGithubCall)).toMatchInlineSnapshot(`
      [
        {
          "init": {
            "cache": "no-store",
          },
          "path": "/repos/myorg/my-repo/contents/stack.config.ts?ref=main",
        },
      ]
    `);
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Could not find stack.config.ts on myorg/my-repo@main. Check that the config file still exists in the linked branch.]`);
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Bad credentials]`);
  });
});
