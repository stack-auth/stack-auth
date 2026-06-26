import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { recordConfigAgentRunResult, setConfigAgentRunAwaitingReview, startConfigAgentRun } from "./index";

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

async function createBranchConfigOverride(configAgentRun: Prisma.InputJsonObject) {
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
    data: { projectId, branchId, config: {}, source: githubSource, configAgentRun },
  });
  return { projectId, branchId };
}

async function readRow(projectId: string, branchId: string) {
  return await globalPrismaClient.branchConfigOverride.findUniqueOrThrow({
    where: { projectId_branchId: { projectId, branchId } },
  });
}

async function readRun(projectId: string, branchId: string): Promise<JsonRecord> {
  const { configAgentRun } = await readRow(projectId, branchId);
  if (!isRecord(configAgentRun)) {
    throw new Error("Expected branch configAgentRun to be a JSON object.");
  }
  return configAgentRun;
}

afterEach(async () => {
  await globalPrismaClient.project.deleteMany({
    where: { id: { in: createdProjectIds.splice(0) } },
  });
});

describe("config agent run state", () => {
  it("overwrites an in-flight run instead of locking it out", async () => {
    const { projectId, branchId } = await createBranchConfigOverride({
      status: "awaiting_review",
      started_at: 1000,
      sandbox_id: "sandbox-awaiting-review",
      diff: "diff --git a/hexclave.config.ts b/hexclave.config.ts",
    });

    const source = await startConfigAgentRun({ projectId, branchId, nowMs: 2000 });

    expect(source.type).toBe("pushed-from-github");
    // A fresh `running` marker replaces the prior run — no awaiting_review leftovers.
    const run = await readRun(projectId, branchId);
    expect(run).toMatchObject({ status: "running", started_at: 2000 });
    expect(run.sandbox_id).toBeUndefined();
    expect(run.diff).toBeUndefined();
  });

  it("ignores stale awaiting_review transitions from an older run", async () => {
    const { projectId, branchId } = await createBranchConfigOverride({
      status: "running",
      started_at: 2000,
      sandbox_id: "newer-sandbox",
    });

    const result = await setConfigAgentRunAwaitingReview({
      projectId,
      branchId,
      runStartedAt: 1000,
      diff: "old diff",
    });

    expect(result.sandboxId).toBeUndefined();
    const run = await readRun(projectId, branchId);
    expect(run).toMatchObject({ status: "running", started_at: 2000, sandbox_id: "newer-sandbox" });
    expect(run.diff).toBeUndefined();
  });

  it("ignores stale terminal writes from an older run", async () => {
    const { projectId, branchId } = await createBranchConfigOverride({
      status: "running",
      started_at: 2000,
      sandbox_id: "newer-sandbox",
    });

    await recordConfigAgentRunResult({
      projectId,
      branchId,
      runStartedAt: 1000,
      nowMs: 3000,
      outcome: {
        status: "success",
        commitUrl: "https://github.com/hexclave-validation/config-agent-validation/commit/stale",
        newCommitHash: "stale-commit",
      },
    });

    const run = await readRun(projectId, branchId);
    expect(run).toMatchObject({ status: "running", started_at: 2000, sandbox_id: "newer-sandbox" });
    // The superseded run must not have advanced the source commit hash.
    const { source } = await readRow(projectId, branchId);
    expect(isRecord(source) ? source.commit_hash : null).toBe("base-commit");
  });
});
