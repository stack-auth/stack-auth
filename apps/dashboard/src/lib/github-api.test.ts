import { describe, expect, it } from "vitest";
import {
  commitFile,
  encodeGitHubPath,
  getFileContent,
  githubRepositoryContentsUrl,
  isObject,
  parseRepositoryFullName,
} from "./github-api";

describe("parseRepositoryFullName", () => {
  it("splits a well-formed full name into owner and repo", () => {
    expect(parseRepositoryFullName("myorg/my-repo")).toEqual({ owner: "myorg", repo: "my-repo" });
    expect(parseRepositoryFullName("acme.io/some_repo.2")).toEqual({ owner: "acme.io", repo: "some_repo.2" });
  });

  it("rejects names without exactly one slash", () => {
    expect(() => parseRepositoryFullName("no-slash")).toThrow(/owner\/repo/);
    expect(() => parseRepositoryFullName("a/b/c")).toThrow(/owner\/repo/);
  });

  it("rejects empty owner or empty repo", () => {
    expect(() => parseRepositoryFullName("/repo")).toThrow(/owner\/repo/);
    expect(() => parseRepositoryFullName("owner/")).toThrow(/owner\/repo/);
  });
});

describe("encodeGitHubPath", () => {
  it("percent-encodes each segment but leaves slashes intact", () => {
    expect(encodeGitHubPath("a/b/c")).toBe("a/b/c");
    expect(encodeGitHubPath("dir with space/file.ts")).toBe("dir%20with%20space/file.ts");
    expect(encodeGitHubPath(".github/workflows/x.yml")).toBe(".github/workflows/x.yml");
  });

  it("encodes special characters in segments", () => {
    expect(encodeGitHubPath("hash#dir/q?file.ts")).toBe("hash%23dir/q%3Ffile.ts");
  });
});

describe("githubRepositoryContentsUrl", () => {
  it("composes a contents URL with encoded owner, repo, and path", () => {
    expect(githubRepositoryContentsUrl("myorg", "my-repo", "stack.config.ts"))
      .toBe("/repos/myorg/my-repo/contents/stack.config.ts");
    expect(githubRepositoryContentsUrl("my org", "my repo", "dir with space/file.ts"))
      .toBe("/repos/my%20org/my%20repo/contents/dir%20with%20space/file.ts");
  });
});

describe("isObject", () => {
  it("matches plain objects only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject("string")).toBe(false);
    expect(isObject(42)).toBe(false);
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
    expect(result).toEqual({ text, sha: "abc123" });
    expect(calls[0].path).toBe("/repos/myorg/my-repo/contents/stack.config.ts?ref=main");
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
    expect(result?.text).toBe(text);
  });

  it("returns null when the file is missing (Not Found error)", async () => {
    const { fn } = fakeGithubFetch(() => {
      throw new Error("Not Found");
    });
    const result = await getFileContent(fn, {
      owner: "o", repo: "r", branch: "main", path: "missing.ts",
    });
    expect(result).toBeNull();
  });

  it("returns null when the response is a directory (array)", async () => {
    const { fn } = fakeGithubFetch(() => [{ type: "file", path: "x" }]);
    const result = await getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x" });
    expect(result).toBeNull();
  });

  it("returns null when the response type is not 'file'", async () => {
    const { fn } = fakeGithubFetch(() => ({ type: "dir", sha: "x", content: "" }));
    const result = await getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x" });
    expect(result).toBeNull();
  });

  it("re-throws non-404 errors", async () => {
    const { fn } = fakeGithubFetch(() => {
      throw new Error("Server error");
    });
    await expect(getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x.ts" }))
      .rejects.toThrow(/Server error/);
  });

  it("throws on unexpected encoding", async () => {
    const { fn } = fakeGithubFetch(() => ({
      type: "file",
      encoding: "utf-8",
      content: "raw",
      sha: "abc",
    }));
    await expect(getFileContent(fn, { owner: "o", repo: "r", branch: "main", path: "x.ts" }))
      .rejects.toThrow(/encoding/);
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
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/repos/myorg/my-repo/contents/stack.config.ts");
    expect(calls[0].init?.method).toBe("PUT");
    const parsedBody = JSON.parse(String(calls[0].init?.body));
    expect(parsedBody.message).toBe("chore: update");
    expect(parsedBody.branch).toBe("main");
    expect(parsedBody.sha).toBe("deadbeef");
    expect(Buffer.from(parsedBody.content, "base64").toString("utf-8")).toBe("hello");
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
    const parsedBody = JSON.parse(String(calls[0].init?.body));
    expect(parsedBody).not.toHaveProperty("sha");
  });
});
