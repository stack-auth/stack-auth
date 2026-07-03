import { describe, expect, it } from "vitest";
import { CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR, ConfigRepoCommitConflictError, rebuildFilesFromDiff } from "./repo-agent";

describe("config repo agent commit conflict", () => {
  it("uses a safe user-facing conflict message", () => {
    // A concurrent push surfaces as this error (the pre-check mismatch or a 422 from
    // the non-forced GitHub ref update); the message must stay in the safe allowlist.
    expect(new ConfigRepoCommitConflictError().message).toMatchInlineSnapshot(
      `"The GitHub branch changed before the config commit could be pushed. Retry the update to apply the same changes on the latest branch."`,
    );
    expect(CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR).toMatchInlineSnapshot(
      `"The GitHub branch changed before the config commit could be pushed. Retry the update to apply the same changes on the latest branch."`,
    );
  });
});

describe("rebuildFilesFromDiff", () => {
  // git diff for a modified file (the config), a brand-new imported file, and a deletion —
  // the kind of multi-file change the agent produces when the config pulls in other files.
  const base = new Map<string, string>([
    ["hexclave.config.ts", "import { theme } from \"./theme\";\nexport default { theme, signUp: false };\n"],
    ["legacy.ts", "export const legacy = true;\n"],
  ]);
  const resolveBase = async (path: string) => base.get(path) ?? "";

  const diff = [
    "diff --git a/hexclave.config.ts b/hexclave.config.ts",
    "index 1111111..2222222 100644",
    "--- a/hexclave.config.ts",
    "+++ b/hexclave.config.ts",
    "@@ -1,2 +1,2 @@",
    " import { theme } from \"./theme\";",
    "-export default { theme, signUp: false };",
    "+export default { theme, signUp: true };",
    "diff --git a/theme.ts b/theme.ts",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/theme.ts",
    "@@ -0,0 +1 @@",
    "+export const theme = \"dark\";",
    "diff --git a/legacy.ts b/legacy.ts",
    "deleted file mode 100644",
    "index 4444444..0000000",
    "--- a/legacy.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-export const legacy = true;",
    "",
  ].join("\n");

  it("rebuilds a modified file, a new file, and a deletion across the whole repo", async () => {
    const files = await rebuildFilesFromDiff(diff, resolveBase);

    expect(files).toContainEqual({
      path: "hexclave.config.ts",
      newContent: "import { theme } from \"./theme\";\nexport default { theme, signUp: true };\n",
    });
    // A new imported file the agent added — applied onto an empty base.
    expect(files).toContainEqual({ path: "theme.ts", newContent: "export const theme = \"dark\";\n" });
    // A deleted file — recorded as a deletion, no content.
    expect(files).toContainEqual({ path: "legacy.ts", deleted: true });
    expect(files).toHaveLength(3);
  });

  it("throws if a hunk cannot be applied onto the given base (stale/corrupt diff)", async () => {
    const wrongBase = async () => "totally different contents\n";
    await expect(rebuildFilesFromDiff(diff, wrongBase)).rejects.toThrow(/Could not rebuild/);
  });
});
