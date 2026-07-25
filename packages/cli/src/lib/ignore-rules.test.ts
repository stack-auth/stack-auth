import { describe, expect, it } from "vitest";
import { isIgnoredByRules, parseIgnoreFile, parseIgnorePattern } from "./ignore-rules.js";

const check = (content: string, relativePath: string, isDirectory = false) =>
  isIgnoredByRules(parseIgnoreFile(content), relativePath, isDirectory);

describe("parseIgnorePattern", () => {
  it("skips comments and blank lines", () => {
    expect(parseIgnorePattern("# a comment")).toBeUndefined();
    expect(parseIgnorePattern("")).toBeUndefined();
    expect(parseIgnorePattern("   ")).toBeUndefined();
  });
});

describe("isIgnoredByRules", () => {
  it("matches basenames at any depth for slash-less patterns", () => {
    expect(check("*.log", "error.log")).toBe(true);
    expect(check("*.log", "deep/nested/error.log")).toBe(true);
    expect(check("*.log", "error.log.txt")).toBe(false);
    expect(check("dist", "dist", true)).toBe(true);
    expect(check("dist", "packages/a/dist", true)).toBe(true);
  });

  it("anchors patterns that contain a slash", () => {
    expect(check("build/output.js", "build/output.js")).toBe(true);
    expect(check("build/output.js", "nested/build/output.js")).toBe(false);
    expect(check("/top.txt", "top.txt")).toBe(true);
    expect(check("/top.txt", "nested/top.txt")).toBe(false);
  });

  it("handles directory-only patterns", () => {
    expect(check("cache/", "cache", true)).toBe(true);
    expect(check("cache/", "cache", false)).toBe(false);
  });

  it("handles negation with last-match-wins", () => {
    const content = "*.env\n!example.env";
    expect(check(content, "secret.env")).toBe(true);
    expect(check(content, "example.env")).toBe(false);
    // Reversed order: the ignore comes later, so it wins.
    expect(check("!example.env\n*.env", "example.env")).toBe(true);
  });

  it("handles ** wildcards", () => {
    expect(check("docs/**", "docs/a.md")).toBe(true);
    expect(check("docs/**", "docs/deep/b.md")).toBe(true);
    expect(check("docs/**", "docs", true)).toBe(false);
    expect(check("**/temp", "temp", true)).toBe(true);
    expect(check("**/temp", "a/b/temp", true)).toBe(true);
    expect(check("a/**/z.txt", "a/z.txt")).toBe(true);
    expect(check("a/**/z.txt", "a/b/c/z.txt")).toBe(true);
  });

  it("handles ? wildcards without crossing directories", () => {
    expect(check("file?.txt", "file1.txt")).toBe(true);
    expect(check("file?.txt", "file12.txt")).toBe(false);
    expect(check("a?c", "a/c")).toBe(false);
  });

  it("does not match partial segments", () => {
    expect(check("foo", "foobar")).toBe(false);
    expect(check("foo", "bar/foo")).toBe(true);
  });

  it("handles character classes", () => {
    expect(check("file[0-9].txt", "file1.txt")).toBe(true);
    expect(check("file[0-9].txt", "fileA.txt")).toBe(false);
    expect(check("file[!0-9].txt", "fileA.txt")).toBe(true);
    expect(check("file[!0-9].txt", "file1.txt")).toBe(false);
    expect(check("[ab]c", "ac")).toBe(true);
    expect(check("[ab]c", "cc")).toBe(false);
    // Unterminated bracket is a literal.
    expect(check("foo[bar", "foo[bar")).toBe(true);
  });

  it("handles backslash escapes", () => {
    expect(check("\\#not-a-comment", "#not-a-comment")).toBe(true);
    expect(check("\\!not-negated", "!not-negated")).toBe(true);
    expect(check("star\\*lit", "star*lit")).toBe(true);
    expect(check("star\\*lit", "starXlit")).toBe(false);
    // Escaped trailing space is preserved.
    expect(check("ends-with-space\\ ", "ends-with-space ")).toBe(true);
  });
});
