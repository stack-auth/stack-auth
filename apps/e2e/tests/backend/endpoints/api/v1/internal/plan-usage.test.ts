import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe } from "vitest";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { planUsageResponseSchema, type PlanUsageResponse } from "@hexclave/shared/dist/interface/plan-usage";
import { it } from "../../../../../helpers";
import { Auth, InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

type ProjectUsageContext = {
  projectId: string,
  tenancyId: string,
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function getInternalDatabaseConnectionString(): string {
  const connectionString = getEnvVariable(
    "HEXCLAVE_DATABASE_CONNECTION_STRING",
    getEnvVariable("STACK_DATABASE_CONNECTION_STRING", ""),
  );
  if (connectionString === "") {
    throw new HexclaveAssertionError("Plan usage E2E tests require a configured internal database connection string");
  }
  return connectionString;
}

async function withInternalDatabase<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: getInternalDatabaseConnectionString(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function getMainTenancyId(client: Client, projectId: string): Promise<string> {
  const tenancies = await client.query<{ id: string }>(
    `SELECT "id" FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = 'main' LIMIT 1`,
    [projectId],
  );
  return tenancies.rows[0]?.id ?? throwErr(`Could not find main tenancy for project ${projectId}`);
}

async function getProjectUsageContext(client: Client, projectId: string): Promise<ProjectUsageContext> {
  return {
    projectId,
    tenancyId: await getMainTenancyId(client, projectId),
  };
}

async function clearSeededUsageRows(client: Client, tenancies: readonly ProjectUsageContext[]): Promise<void> {
  const tenancyIds = tenancies.map((tenancy) => tenancy.tenancyId);
  await client.query(`DELETE FROM "SessionReplay" WHERE "tenancyId" = ANY($1::uuid[])`, [tenancyIds]);
  await client.query(`DELETE FROM "EmailOutbox" WHERE "tenancyId" = ANY($1::uuid[])`, [tenancyIds]);
  await client.query(`DELETE FROM "ProjectUser" WHERE "tenancyId" = ANY($1::uuid[])`, [tenancyIds]);
}

function normalizeSubscriptionPeriodInJson(value: unknown, ownerTeamId: string, period: {
  start: Date,
  end: Date,
}): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSubscriptionPeriodInJson(item, ownerTeamId, period));
  }
  if (typeof value === "object") {
    const normalizedObject: { [key: string]: JsonValue } = {};
    for (const [key, entryValue] of Object.entries(value)) {
      normalizedObject[key] = normalizeSubscriptionPeriodInJson(entryValue, ownerTeamId, period);
    }
    if (
      normalizedObject.customerId === ownerTeamId
      && typeof normalizedObject.currentPeriodStartMillis === "number"
      && typeof normalizedObject.currentPeriodEndMillis === "number"
    ) {
      return {
        ...normalizedObject,
        currentPeriodStartMillis: period.start.getTime(),
        currentPeriodEndMillis: period.end.getTime(),
      };
    }
    return normalizedObject;
  }
  throw new HexclaveAssertionError("Unexpected non-JSON value in payment storage", { value });
}

async function normalizeBillingTeamSubscriptionMapPeriod(client: Client, ownerTeamId: string, period: {
  start: Date,
  end: Date,
}): Promise<void> {
  // The E2E seed data can create zero-length payment periods in the Bulldozer LFold output.
  // Plan usage reads that output directly, so normalize only this fresh test team's emitted
  // subscription-map rows to make the metered usage period deterministic.
  const rows = await client.query<{ id: string, value: unknown }>(
    `
      SELECT "id", "value"
      FROM "BulldozerStorageEngine"
      WHERE "keyPath"[1] = to_jsonb('table'::text)
        AND "keyPath"[2] = to_jsonb('external:payments-subscription-map-by-customer'::text)
        AND "keyPath"::text LIKE $1
        AND "value" <> 'null'::jsonb
    `,
    [`%${ownerTeamId}%`],
  );
  if (rows.rows.length === 0) {
    throw new HexclaveAssertionError("Expected payment subscription-map rows for billing team", { ownerTeamId });
  }
  for (const row of rows.rows) {
    await client.query(
      `UPDATE "BulldozerStorageEngine" SET "value" = $2::jsonb WHERE "id" = $1::uuid`,
      [row.id, JSON.stringify(normalizeSubscriptionPeriodInJson(row.value, ownerTeamId, period))],
    );
  }
}

async function insertProjectUsers(client: Client, context: ProjectUsageContext, options: {
  nonAnonymousCount: number,
  anonymousCount: number,
}): Promise<string[]> {
  const nonAnonymousUsers = await client.query<{ projectUserId: string }>(
    `
      INSERT INTO "ProjectUser"
        ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
         "displayName", "createdAt", "updatedAt", "isAnonymous",
         "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse")
      SELECT
        $1::uuid,
        gen_random_uuid(),
        $2,
        'main',
        'Plan Usage User ' || gs,
        now(),
        now(),
        false,
        now(),
        0,
        0
      FROM generate_series(1, $3::int) AS gs
      RETURNING "projectUserId"
    `,
    [context.tenancyId, context.projectId, options.nonAnonymousCount],
  );

  await client.query(
    `
      INSERT INTO "ProjectUser"
        ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
         "displayName", "createdAt", "updatedAt", "isAnonymous",
         "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse")
      SELECT
        $1::uuid,
        gen_random_uuid(),
        $2,
        'main',
        'Plan Usage Anonymous User ' || gs,
        now(),
        now(),
        true,
        now(),
        0,
        0
      FROM generate_series(1, $3::int) AS gs
    `,
    [context.tenancyId, context.projectId, options.anonymousCount],
  );

  return nonAnonymousUsers.rows.map((row) => row.projectUserId);
}

async function insertEmailOutboxRow(client: Client, tenancyId: string, startedSendingAt: Date | null): Promise<void> {
  const renderedAt = new Date();
  await client.query(
    `
      INSERT INTO "EmailOutbox"
        ("tenancyId", "id", "createdAt", "updatedAt", "tsxSource", "isHighPriority", "to", "extraRenderVariables",
         "shouldSkipDeliverabilityCheck", "createdWith", "renderedByWorkerId", "startedRenderingAt",
         "finishedRenderingAt", "renderedHtml", "renderedSubject", "renderedIsTransactional",
         "scheduledAt", "isQueued", "startedSendingAt", "finishedSendingAt", "canHaveDeliveryInfo")
      VALUES
        ($1::uuid, gen_random_uuid(), $4, $4, '', false, $2::jsonb, '{}'::jsonb,
         true, 'PROGRAMMATIC_CALL', $3::uuid, $4, $4, '<p>usage test</p>',
         'Plan usage test email', true, $4, true, $5, $5, $6)
    `,
    [
      tenancyId,
      JSON.stringify({ type: "custom-emails", emails: ["usage-test@example.com"] }),
      randomUUID(),
      renderedAt,
      startedSendingAt,
      startedSendingAt == null ? null : false,
    ],
  );
}

async function insertSessionReplayRow(client: Client, context: ProjectUsageContext, projectUserId: string, startedAt: Date): Promise<void> {
  await client.query(
    `
      INSERT INTO "SessionReplay"
        ("tenancyId", "id", "projectUserId", "refreshTokenId", "startedAt", "lastEventAt", "createdAt", "updatedAt")
      VALUES
        ($1::uuid, gen_random_uuid(), $2::uuid, $3::uuid, $4, $4, $4, $4)
    `,
    [context.tenancyId, projectUserId, randomUUID(), startedAt],
  );
}

async function getPlanUsage(): Promise<PlanUsageResponse> {
  const response = await niceBackendFetch("/api/latest/internal/plan-usage", {
    accessType: "admin",
  });
  if (response.status !== 200) {
    throw new HexclaveAssertionError("Expected plan usage request to succeed", { response });
  }
  return await planUsageResponseSchema.validate(response.body);
}

async function purchaseTeamPlanForBillingTeam(ownerTeamId: string): Promise<void> {
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "team",
      customer_id: ownerTeamId,
      product_id: "team",
    },
  });
  if (createUrlResponse.status !== 200 || typeof createUrlResponse.body?.url !== "string") {
    throw new HexclaveAssertionError("Expected team plan purchase URL creation to succeed", { createUrlResponse });
  }

  const fullCode = createUrlResponse.body.url.match(/\/purchase\/([a-z0-9_-]+)/)?.[1]
    ?? throwErr("Could not parse purchase code from team plan purchase URL", { createUrlResponse });
  const purchaseResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: fullCode,
      price_id: "monthly",
      quantity: 1,
    },
  });
  if (purchaseResponse.status !== 200) {
    throw new HexclaveAssertionError("Expected test-mode team plan purchase to succeed", { purchaseResponse });
  }
}

function getUsedUsageValue(usage: PlanUsageResponse, itemId: string): number {
  const row = usage.rows.find((candidate) => candidate.item_id === itemId) ?? throwErr(`Missing usage row for ${itemId}`);
  return row.used ?? throwErr(`Expected usage row ${itemId} to have a used value`);
}

function getCalendarMonthBounds(now: Date): { start: Date, end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function waitForPlanUsageValues(expected: {
  authUsers: number,
  emails: number,
  sessionReplays: number,
  analyticsEvents: number,
}): Promise<PlanUsageResponse> {
  const startedAt = performance.now();
  let latestUsage: PlanUsageResponse | undefined;
  while (performance.now() - startedAt < 15_000) {
    latestUsage = await getPlanUsage();
    if (
      getUsedUsageValue(latestUsage, ITEM_IDS.authUsers) === expected.authUsers
      && getUsedUsageValue(latestUsage, ITEM_IDS.emailsPerMonth) === expected.emails
      && getUsedUsageValue(latestUsage, ITEM_IDS.sessionReplays) === expected.sessionReplays
      && getUsedUsageValue(latestUsage, ITEM_IDS.analyticsEvents) === expected.analyticsEvents
    ) {
      return latestUsage;
    }
    await wait(250);
  }
  throw new HexclaveAssertionError("Timed out waiting for seeded plan usage to be visible", {
    latestUsage,
    expected,
  });
}

describe("internal plan usage", () => {
  it("returns zero usage for a fresh owned project with no seeded usage rows", async ({ expect }) => {
    const { projectId } = await Project.createAndSwitch({
      display_name: "Plan Usage Empty Project",
    });

    await withInternalDatabase(async (client) => {
      const context = await getProjectUsageContext(client, projectId);
      await clearSeededUsageRows(client, [context]);
    });

    const usage = await getPlanUsage();

    expect(usage.owner_team_id).toBeTruthy();
    expect(usage.plan_id).toBe("free");
    expect(getUsedUsageValue(usage, ITEM_IDS.authUsers)).toBe(0);
    expect(getUsedUsageValue(usage, ITEM_IDS.emailsPerMonth)).toBe(0);
    expect(getUsedUsageValue(usage, ITEM_IDS.sessionReplays)).toBe(0);
    expect(getUsedUsageValue(usage, ITEM_IDS.analyticsEvents)).toBe(0);
  });

  it("rolls up metered usage across all projects owned by the billing team", async ({ expect }) => {
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    await Auth.fastSignUp();
    const internalUserAuth = backendContext.value.userAuth ?? throwErr("Expected internal user auth after sign-up");

    const primaryProject = await Project.createAndSwitch({
      display_name: "Plan Usage Primary Project",
    }, true);
    const primaryProjectKeys = backendContext.value.projectKeys;
    const ownerTeamId = primaryProject.createProjectResponse.body.owner_team_id;
    if (typeof ownerTeamId !== "string") {
      throw new HexclaveAssertionError("Expected created project to include an owner team ID", { primaryProject });
    }

    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: internalUserAuth });
    await purchaseTeamPlanForBillingTeam(ownerTeamId);
    const secondaryProject = await Project.create({
      display_name: "Plan Usage Secondary Project",
      owner_team_id: ownerTeamId,
    });

    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    const unrelatedProject = await Project.createAndSwitch({
      display_name: "Plan Usage Unrelated Project",
    });

    backendContext.set({ projectKeys: primaryProjectKeys, userAuth: null });

    const { start, end } = getCalendarMonthBounds(new Date());
    const outsideBefore = new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000);
    const insidePrimary = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
    const insideSecondaryA = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
    const insideSecondaryB = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
    const outsideAfter = new Date(end.getTime() + 2 * 24 * 60 * 60 * 1000);

    await withInternalDatabase(async (client) => {
      const primary = await getProjectUsageContext(client, primaryProject.projectId);
      const secondary = await getProjectUsageContext(client, secondaryProject.projectId);
      const unrelated = await getProjectUsageContext(client, unrelatedProject.projectId);
      await clearSeededUsageRows(client, [primary, secondary, unrelated]);
      await normalizeBillingTeamSubscriptionMapPeriod(client, ownerTeamId, { start, end });

      const primaryUserIds = await insertProjectUsers(client, primary, {
        nonAnonymousCount: 2,
        anonymousCount: 1,
      });
      const secondaryUserIds = await insertProjectUsers(client, secondary, {
        nonAnonymousCount: 1,
        anonymousCount: 0,
      });
      const unrelatedUserIds = await insertProjectUsers(client, unrelated, {
        nonAnonymousCount: 2,
        anonymousCount: 0,
      });
      const firstPrimaryUserId = primaryUserIds[0] ?? throwErr("Expected seeded primary project user");
      const secondPrimaryUserId = primaryUserIds[1] ?? throwErr("Expected second seeded primary project user");
      const firstSecondaryUserId = secondaryUserIds[0] ?? throwErr("Expected seeded secondary project user");
      const firstUnrelatedUserId = unrelatedUserIds[0] ?? throwErr("Expected seeded unrelated project user");

      await insertEmailOutboxRow(client, primary.tenancyId, insidePrimary);
      await insertEmailOutboxRow(client, primary.tenancyId, insideSecondaryA);
      await insertEmailOutboxRow(client, secondary.tenancyId, insideSecondaryB);
      await insertEmailOutboxRow(client, primary.tenancyId, outsideBefore);
      await insertEmailOutboxRow(client, secondary.tenancyId, outsideAfter);
      await insertEmailOutboxRow(client, primary.tenancyId, null);
      await insertEmailOutboxRow(client, unrelated.tenancyId, insidePrimary);

      await insertSessionReplayRow(client, primary, firstPrimaryUserId, insidePrimary);
      await insertSessionReplayRow(client, primary, secondPrimaryUserId, outsideBefore);
      await insertSessionReplayRow(client, secondary, firstSecondaryUserId, insideSecondaryA);
      await insertSessionReplayRow(client, secondary, firstSecondaryUserId, insideSecondaryB);
      await insertSessionReplayRow(client, secondary, firstSecondaryUserId, outsideAfter);
      await insertSessionReplayRow(client, unrelated, firstUnrelatedUserId, insidePrimary);
    });

    const usage = await waitForPlanUsageValues({
      authUsers: 3,
      emails: 3,
      sessionReplays: 3,
      analyticsEvents: 0,
    });

    expect(usage.owner_team_id).toBe(ownerTeamId);
    expect(usage.plan_id).toBe("team");
    expect(usage.period_start_millis).toBe(start.getTime());
    expect(usage.period_end_millis).toBe(end.getTime());
    expect(getUsedUsageValue(usage, ITEM_IDS.authUsers)).toBe(3);
    expect(getUsedUsageValue(usage, ITEM_IDS.emailsPerMonth)).toBe(3);
    expect(getUsedUsageValue(usage, ITEM_IDS.sessionReplays)).toBe(3);
    expect(getUsedUsageValue(usage, ITEM_IDS.analyticsEvents)).toBe(0);
  });
});
