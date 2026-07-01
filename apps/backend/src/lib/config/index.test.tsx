import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { cancelConfigAgentRun, getConfigAgentRun, getConfigAgentRunChange, recordConfigAgentRunResult, recordConfigAgentRunSandbox, setConfigAgentRunAwaitingReview, startConfigAgentRun } from "./index";

const createdProjectIds: string[] = [];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

const githubSource: Prisma.InputJsonObject = {
  type: "pushed-from-github",
  owner: "hexclave-validation",
  repo: "config-agent-validation",
  branch: "main",
  commit_hash: "base-commit",
  config_file_path: "hexclave.config.ts",
};

async function createGithubLinkedBranch() {
  const projectId = randomUUID();
  const branchId = "main";
  createdProjectIds.push(projectId);
  await globalPrismaClient.project.create({
    data: {
      id: projectId,
      displayName: "Config agent validation",
      isProductionMode: false,
      isDevelopmentEnvironment: true,
    },
  });
  await globalPrismaClient.branchConfigOverride.create({
    data: { projectId, branchId, config: {}, source: githubSource },
  });
  return { projectId, branchId };
}

async function readBranchRow(projectId: string, branchId: string) {
  return await globalPrismaClient.branchConfigOverride.findUniqueOrThrow({
    where: { projectId_branchId: { projectId, branchId } },
  });
}

afterEach(async () => {
  // ConfigAgentRun rows cascade-delete with the project.
  await globalPrismaClient.project.deleteMany({
    where: { id: { in: createdProjectIds.splice(0) } },
  });
});

describe("config agent run state", () => {
  it("starts independent runs for the same branch instead of overwriting", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();

    const first = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });
    const second = await startConfigAgentRun({ projectId, branchId, nowMs: 2000 });

    expect(first.source.type).toBe("pushed-from-github");
    expect(first.runId).not.toBe(second.runId);
    // Runs are NOT serialized: both rows coexist, each still "running".
    expect((await getConfigAgentRun({ projectId, branchId, runId: first.runId }))?.status).toBe("running");
    expect((await getConfigAgentRun({ projectId, branchId, runId: second.runId }))?.status).toBe("running");
  });

  it("scopes a run read to its own project/branch", async () => {
    const a = await createGithubLinkedBranch();
    const b = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId: a.projectId, branchId: a.branchId, nowMs: 1000 });

    // The run id is real, but asking under a different project must not leak it.
    expect(await getConfigAgentRun({ projectId: b.projectId, branchId: b.branchId, runId })).toBeNull();
    expect((await getConfigAgentRun({ projectId: a.projectId, branchId: a.branchId, runId }))?.id).toBe(runId);
  });

  it("won't move a cancelled run to awaiting_review", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });
    await recordConfigAgentRunSandbox({ runId, sandboxId: "sandbox-1" });

    const cancel = await cancelConfigAgentRun({ projectId, branchId, runId, nowMs: 2000 });
    expect(cancel).toMatchObject({ cancelled: true, sandboxId: "sandbox-1", previousStatus: "running" });

    // A late transition from the agent must not resurrect the cancelled run.
    await setConfigAgentRunAwaitingReview({ runId, change: { diff: "old diff", baseSha: "abc123" } });

    const run = await getConfigAgentRun({ projectId, branchId, runId });
    expect(run?.status).toBe("cancelled");
    expect(run?.diff).toBeUndefined();
  });

  it("captures the diff + base commit on awaiting_review; base commit is server-only", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });

    const change = { diff: "diff --git a/hexclave.config.ts b/hexclave.config.ts\n@@ -1 +1 @@\n-a\n+b\n", baseSha: "abc123" };
    await setConfigAgentRunAwaitingReview({ runId, change });

    // The captured change is readable for the commit route...
    const plan = await getConfigAgentRunChange({ projectId, branchId, runId });
    expect(plan?.status).toBe("awaiting_review");
    expect(plan?.change).toEqual(change);

    // ...the dashboard sees the diff but never the base commit (and sandbox id is cleared).
    const run = await getConfigAgentRun({ projectId, branchId, runId });
    expect(run?.status).toBe("awaiting_review");
    expect(run?.diff).toBe(change.diff);
    expect(run?.sandbox_id).toBeUndefined();
    expect(run as Record<string, unknown>).not.toHaveProperty("base_commit_sha");
    expect(run as Record<string, unknown>).not.toHaveProperty("baseCommitSha");

    // The captured change scopes to its own project/branch like the run read does.
    const other = await createGithubLinkedBranch();
    expect(await getConfigAgentRunChange({ projectId: other.projectId, branchId: other.branchId, runId })).toBeNull();
  });

  it("advances the source commit hash on a successful result", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });
    await setConfigAgentRunAwaitingReview({ runId, change: { diff: "diff --git a/hexclave.config.ts b/hexclave.config.ts", baseSha: "abc123" } });

    await recordConfigAgentRunResult({
      projectId,
      branchId,
      runId,
      nowMs: 3000,
      outcome: {
        status: "success",
        commitUrl: "https://github.com/hexclave-validation/config-agent-validation/commit/new",
        newCommitHash: "new-commit",
        committedRef: { owner: "hexclave-validation", repo: "config-agent-validation", branch: "main" },
      },
    });

    expect((await getConfigAgentRun({ projectId, branchId, runId }))?.status).toBe("success");
    const { source } = await readBranchRow(projectId, branchId);
    expect(isRecord(source) ? source.commit_hash : null).toBe("new-commit");
  });

  it("does not advance the commit hash when the branch was re-linked to a different repo mid-run", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });
    await setConfigAgentRunAwaitingReview({ runId, change: { diff: "diff --git a/hexclave.config.ts b/hexclave.config.ts", baseSha: "abc123" } });

    // The branch is re-linked to a DIFFERENT repo after the commit was pushed but
    // before the result is recorded.
    await globalPrismaClient.branchConfigOverride.update({
      where: { projectId_branchId: { projectId, branchId } },
      data: { source: { ...githubSource, repo: "some-other-repo", commit_hash: "other-base" } },
    });

    await recordConfigAgentRunResult({
      projectId,
      branchId,
      runId,
      nowMs: 3000,
      outcome: {
        status: "success",
        commitUrl: "https://github.com/hexclave-validation/config-agent-validation/commit/new",
        newCommitHash: "new-commit",
        committedRef: { owner: "hexclave-validation", repo: "config-agent-validation", branch: "main" },
      },
    });

    // The run still succeeds, but the new repo's source must NOT inherit a hash from
    // the old repo's commit.
    expect((await getConfigAgentRun({ projectId, branchId, runId }))?.status).toBe("success");
    const { source } = await readBranchRow(projectId, branchId);
    expect(isRecord(source) ? source.commit_hash : null).toBe("other-base");
  });

  it("ignores a terminal result for an already-cancelled run", async () => {
    const { projectId, branchId } = await createGithubLinkedBranch();
    const { runId } = await startConfigAgentRun({ projectId, branchId, nowMs: 1000 });
    await cancelConfigAgentRun({ projectId, branchId, runId, nowMs: 2000 });

    await recordConfigAgentRunResult({
      projectId,
      branchId,
      runId,
      nowMs: 3000,
      outcome: {
        status: "success",
        commitUrl: "https://github.com/hexclave-validation/config-agent-validation/commit/stale",
        newCommitHash: "stale-commit",
        committedRef: { owner: "hexclave-validation", repo: "config-agent-validation", branch: "main" },
      },
    });

    // The cancel wins; neither the run status nor the source commit hash moves.
    expect((await getConfigAgentRun({ projectId, branchId, runId }))?.status).toBe("cancelled");
    const { source } = await readBranchRow(projectId, branchId);
    expect(isRecord(source) ? source.commit_hash : null).toBe("base-commit");
  });
});
