import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { globalPrismaClient } from "@/prisma-client";

const replicationStrategy = getEnvVariable("STACK_DATABASE_REPLICATION_WAIT_STRATEGY", "none");
const replicaConnectionString = getEnvVariable("STACK_DATABASE_REPLICA_CONNECTION_STRING", "");
const replicationWaitEnabled = replicationStrategy !== "none" && replicaConnectionString !== "";

function queryText(query: unknown): string {
  if (typeof query === "string") return query;
  if (query !== null && typeof query === "object" && "text" in query && typeof query.text === "string") {
    return query.text;
  }
  return "";
}

const hasReplicationTargetQuery = (calls: readonly (readonly unknown[])[]) =>
  calls.some(([query]) => queryText(query).toLowerCase().includes("select pg_current_wal_lsn"));

describe.skipIf(!replicationWaitEnabled)("replication wait behavior", () => {
  let restoreQuerySpy: (() => void) | undefined;

  afterEach(() => {
    restoreQuerySpy?.();
    restoreQuerySpy = undefined;
  });

  it("does not wait after a model read routed to the replica", async () => {
    const querySpy = vi.spyOn(Client.prototype, "query");
    restoreQuerySpy = () => querySpy.mockRestore();

    await globalPrismaClient.team.findMany({
      take: 1,
      select: { teamId: true },
    });

    expect(hasReplicationTargetQuery(querySpy.mock.calls)).toBe(false);
  });

  it("waits after a write on the primary", async () => {
    const querySpy = vi.spyOn(Client.prototype, "query");
    restoreQuerySpy = () => querySpy.mockRestore();

    await globalPrismaClient.team.updateMany({
      where: { teamId: "00000000-0000-0000-0000-000000000000" },
      data: { displayName: "replication wait test" },
    });

    expect(hasReplicationTargetQuery(querySpy.mock.calls)).toBe(true);
  });

  it("waits after a transaction commits", async () => {
    const querySpy = vi.spyOn(Client.prototype, "query");
    restoreQuerySpy = () => querySpy.mockRestore();

    // eslint-disable-next-line no-restricted-syntax
    await globalPrismaClient.$transaction(async (tx) => {
      await tx.team.findMany({
        take: 1,
        select: { teamId: true },
      });
    });

    expect(hasReplicationTargetQuery(querySpy.mock.calls)).toBe(true);
  });
});
