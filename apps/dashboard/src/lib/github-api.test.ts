import { describe, expect, it } from "vitest";
import {
  commitFile,
  encodeGitHubPath,
  getFileContent,
  githubRepositoryContentsUrl,
  isObject,
  parseRepositoryFullName,
} from "./github-api";

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

describe("parseRepositoryFullName", () => {
  it("splits a well-formed full name into owner and repo", () => {
    expect([
      parseRepositoryFullName("myorg/my-repo"),
      parseRepositoryFullName("acme.io/some_repo.2"),
    ]).toMatchInlineSnapshot(`
      [
        {
          "owner": "myorg",
          "repo": "my-repo",
        },
        {
          "owner": "acme.io",
          "repo": "some_repo.2",
        },
      ]
    `);
  });

  it("rejects names without exactly one slash", () => {
    expect(() => parseRepositoryFullName("no-slash")).toThrowErrorMatchingInlineSnapshot(`[Error: Repository must be in the format 'owner/repo' (got 'no-slash').]`);
    expect(() => parseRepositoryFullName("a/b/c")).toThrowErrorMatchingInlineSnapshot(`[Error: Repository must be in the format 'owner/repo' (got 'a/b/c').]`);
  });

  it("rejects empty owner or empty repo", () => {
    expect(() => parseRepositoryFullName("/repo")).toThrowErrorMatchingInlineSnapshot(`[Error: Repository must be in the format 'owner/repo' (got '/repo').]`);
    expect(() => parseRepositoryFullName("owner/")).toThrowErrorMatchingInlineSnapshot(`[Error: Repository must be in the format 'owner/repo' (got 'owner/').]`);
  });
});

describe("encodeGitHubPath", () => {
  it("percent-encodes each segment but leaves slashes intact", () => {
    expect([
      encodeGitHubPath("a/b/c"),
      encodeGitHubPath("dir with space/file.ts"),
      encodeGitHubPath(".github/workflows/x.yml"),
    ]).toMatchInlineSnapshot(`
      [
        "a/b/c",
        "dir%20with%20space/file.ts",
        ".github/workflows/x.yml",
      ]
    `);
  });

  it("encodes special characters in segments", () => {
    expect(encodeGitHubPath("hash#dir/q?file.ts")).toMatchInlineSnapshot(`"hash%23dir/q%3Ffile.ts"`);
  });
});

describe("githubRepositoryContentsUrl", () => {
  it("composes a contents URL with encoded owner, repo, and path", () => {
    expect([
      githubRepositoryContentsUrl("myorg", "my-repo", "stack.config.ts"),
      githubRepositoryContentsUrl("my org", "my repo", "dir with space/file.ts"),
    ]).toMatchInlineSnapshot(`
      [
        "/repos/myorg/my-repo/contents/stack.config.ts",
        "/repos/my%20org/my%20repo/contents/dir%20with%20space/file.ts",
      ]
    `);
  });
});

describe("isObject", () => {
  it("matches plain objects only", () => {
    expect([
      isObject({}),
      isObject({ a: 1 }),
      isObject(null),
      isObject([]),
      isObject("string"),
      isObject(42),
    ]).toMatchInlineSnapshot(`
      [
        true,
        true,
        false,
        false,
        false,
        false,
      ]
    `);
  });
});

describe("getFileContent", () => {
  function fakeGithubFetch(handler: (path: string, init?: RequestInit) => unknown) {
    const calls: { path: string, init?: RequestInit }[] = [];
    const fn = async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return handler(path, init);
    };
    return { fn, calls };
  }

  it("decodes base64 content and returns the SHA on success", async () => {
    const text = "export const config = {};\n";
    const base64 = Buffer.from(text, "utf-8").toString("base64");
    const { fn, calls } = fakeGithubFetch(() => ({
      type: "file",
      encoding: "base64",
      content: base64,
      sha: "abc123",
    }));

    const result = await getFileContent(fn, {
      owner: "myorg",
      repo: "my-repo",
      branch: "main",
      path: "stack.config.ts",
    });
    expect({ result, calls }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "init": {
              "cache": "no-store",
            },
            "path": "/repos/myorg/my-repo/contents/stack.config.ts?ref=main",
          },
        ],
        "result": {
          "sha": "abc123",
          "text": "export const config = {};
      ",
        },
      }
    `);
  });

  it("handles base64 content with embedded whitespace (GitHub line-wraps long blobs)", async () => {
    const text = "x".repeat(200);
    const base64 = Buffer.from(text, "utf-8").toString("base64");
    const wrapped = base64.match(/.{1,60}/g)!.join("\n");
    const { fn } = fakeGithubFetch(() => ({
      type: "file",
      encoding: "base64",
      content: wrapped,
      sha: "abc",
    }));
    const result = await getFileContent(fn, {
      owner: "o",
      repo: "r",
      branch: "main",
      path: "stack.config.ts",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "sha": "abc",
        "text": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      }
    `);
  });

  it("returns null when the file is missing (Not Found error)", async () => {
    const { fn } = fakeGithubFetch(() => {
      throw new Error("Not Found");
    });
    const result = await getFileContent(fn, {
      owner: "o", repo: "r", branch: "main", path: "missing.ts",
    });
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("returns null when the response is a directory (array)", async () => {
    const { fn } = fakeGithubFetch(() => [{ type: "file", path: "x" }]);
    const result = await getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x" });
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("returns null when the response type is not 'file'", async () => {
    const { fn } = fakeGithubFetch(() => ({ type: "dir", sha: "x", content: "" }));
    const result = await getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x" });
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("re-throws non-404 errors", async () => {
    const { fn } = fakeGithubFetch(() => {
      throw new Error("Server error");
    });
    await expect(getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x.ts" }))
      .rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Server error]`);
  });

  it("throws on unexpected encoding", async () => {
    const { fn } = fakeGithubFetch(() => ({
      type: "file",
      encoding: "utf-8",
      content: "raw",
      sha: "abc",
    }));
    await expect(getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x.ts" }))
      .rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Unexpected GitHub file encoding 'utf-8'.]`);
  });
});

describe("commitFile", () => {
  it("PUTs the encoded content with the given message and sha", async () => {
    const calls: { path: string, init?: RequestInit }[] = [];
    const fn = async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return null;
    };
    await commitFile(fn, {
      owner: "myorg",
      repo: "my-repo",
      branch: "main",
      path: "stack.config.ts",
      content: "hello",
      message: "chore: update",
      sha: "deadbeef",
    });
    expect(calls.map(snapshotGithubCall)).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "branch": "main",
            "content": "hello",
            "message": "chore: update",
            "sha": "deadbeef",
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

  it("omits sha when creating a new file", async () => {
    const calls: { path: string, init?: RequestInit }[] = [];
    const fn = async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return null;
    };
    await commitFile(fn, {
      owner: "o", repo: "r", branch: "main", path: "new.ts", content: "x", message: "create",
    });
    expect(calls.map(snapshotGithubCall)).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "branch": "main",
            "content": "x",
            "message": "create",
          },
          "headers": {
            "content-type": "application/json",
          },
          "method": "PUT",
          "path": "/repos/o/r/contents/new.ts",
        },
      ]
    `);
  });
});
