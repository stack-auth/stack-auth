import { describe, expect, it } from "vitest";
import { CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR, ConfigRepoCommitConflictError, isGitBranchConflictOutput } from "./repo-agent";

describe("config repo agent commit conflict detection", () => {
  it("detects GitHub non-fast-forward push rejection output", () => {
    expect(isGitBranchConflictOutput(`
      To https://github.com/acme/app.git
       ! [rejected]        HEAD -> main (non-fast-forward)
      error: failed to push some refs to 'https://github.com/acme/app.git'
      hint: Updates were rejected because the tip of your current branch is behind
      hint: its remote counterpart. Integrate the remote changes before pushing again.
    `)).toMatchInlineSnapshot(`true`);
  });

  it("detects stale-info push rejection output", () => {
    expect(isGitBranchConflictOutput(`
      ! [rejected] HEAD -> feature/config (stale info)
      error: failed to push some refs to 'https://github.com/acme/app.git'
    `)).toMatchInlineSnapshot(`true`);
  });

  it("does not treat unrelated git failures as branch conflicts", () => {
    expect(isGitBranchConflictOutput("fatal: Authentication failed for 'https://github.com/acme/app.git/'")).toMatchInlineSnapshot(`false`);
  });

  it("uses a safe user-facing conflict message", () => {
    expect(new ConfigRepoCommitConflictError().message).toMatchInlineSnapshot(
      `"The GitHub branch changed before the config commit could be pushed. Retry the update to apply the same changes on the latest branch."`,
    );
    expect(CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR).toMatchInlineSnapshot(
      `"The GitHub branch changed before the config commit could be pushed. Retry the update to apply the same changes on the latest branch."`,
    );
  });
});
