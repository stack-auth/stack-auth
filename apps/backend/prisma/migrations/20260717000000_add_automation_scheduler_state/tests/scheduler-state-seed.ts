import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const stateRows = await sql`
    SELECT "key", "completedTenancyCursor", "activeTenancyId", "completedRuleCursor",
      "activeRuleId", "nextSubjectCursor", "leaseOwner", "leaseExpiresAt"
    FROM "AutomationSchedulerState"
  `;
  expect(Array.from(stateRows)).toEqual([{
    key: "usage-email-v1",
    completedTenancyCursor: null,
    activeTenancyId: null,
    completedRuleCursor: null,
    activeRuleId: null,
    nextSubjectCursor: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  }]);
};
