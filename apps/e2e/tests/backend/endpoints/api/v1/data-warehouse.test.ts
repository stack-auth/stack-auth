import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { it } from "../../../../helpers";
import { Project, niceBackendFetch, withInternalProject } from "../../../backend-helpers";
import { waitForItemQuantityToReach } from "../../../payment-quota-helpers";

/**
 * Creates a project whose billing team is on the team plan, which is what
 * entitles it to a Data Warehouse.
 */
async function createEntitledProject() {
  const { createProjectResponse, projectId } = await Project.createAndSwitch();
  const ownerTeamId = createProjectResponse.body.owner_team_id;
  await withInternalProject(async () => {
    const grantResponse = await niceBackendFetch(`/api/v1/payments/products/team/${ownerTeamId}`, {
      method: "POST",
      accessType: "server",
      body: { product_id: "team" },
    });
    if (grantResponse.status !== 200) {
      throw new HexclaveAssertionError(`Failed to grant the team plan to '${ownerTeamId}'`, { response: grantResponse });
    }
  });
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.dataWarehouse, 1);
  return { projectId, ownerTeamId };
}

async function provision() {
  return await niceBackendFetch("/api/v1/data-warehouse/provision", {
    method: "POST",
    accessType: "admin",
    body: {},
  });
}

async function getWarehouse() {
  return await niceBackendFetch("/api/v1/data-warehouse", { accessType: "admin" });
}

async function runAnalyticsQuery(query: string) {
  return await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "server",
    body: { query },
  });
}

/**
 * Talks to ClickHouse directly as the customer would, which is the only way to
 * exercise the write path — `/analytics/query` pins `readonly=1`.
 */
async function clickhouse(options: { username: string, password: string, query: string }) {
  const url = new URL(process.env.HEXCLAVE_CLICKHOUSE_URL ?? throwMissingClickhouseUrl());
  url.searchParams.set("user", options.username);
  url.searchParams.set("password", options.password);
  const response = await fetch(url, { method: "POST", body: options.query });
  return { status: response.status, text: (await response.text()).trim() };
}

function throwMissingClickhouseUrl(): never {
  throw new HexclaveAssertionError("HEXCLAVE_CLICKHOUSE_URL is not set; the Data Warehouse tests need to reach ClickHouse directly");
}

it("is not provisioned by default, but reports the database name it would get", async ({ expect }) => {
  const { projectId } = await Project.createAndSwitch();
  const response = await getWarehouse();
  expect(response.status).toBe(200);
  expect(response.body.status).toBe("not_provisioned");
  expect(response.body.database_name).toBe(projectId);
  expect(response.body.username).toBe(null);
  expect(response.body.password_updated_at_millis).toBe(null);
});

it("cannot be provisioned on the free plan", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await provision();
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    code: "ITEM_QUANTITY_INSUFFICIENT_AMOUNT",
    details: { item_id: ITEM_IDS.dataWarehouse },
  });
});

it("provisions a database and user on the team plan, returning the password exactly once", async ({ expect }) => {
  const { projectId } = await createEntitledProject();

  const provisionResponse = await provision();
  expect(provisionResponse.status).toBe(200);
  expect(provisionResponse.body.database_name).toBe(projectId);
  expect(provisionResponse.body.username).toBe(projectId);
  expect(typeof provisionResponse.body.password).toBe("string");
  expect(provisionResponse.body.password.length).toBeGreaterThan(20);

  const getResponse = await getWarehouse();
  expect(getResponse.status).toBe(200);
  expect(getResponse.body.status).toBe("ready");
  expect(getResponse.body.username).toBe(projectId);
  expect(getResponse.body).not.toHaveProperty("password");
  expect(getResponse.body.password_updated_at_millis).toEqual(expect.any(Number));
});

it("refuses to provision twice, so live credentials are never silently invalidated", async ({ expect }) => {
  await createEntitledProject();
  expect((await provision()).status).toBe(200);
  const second = await provision();
  expect(second.status).toBe(400);
  // StatusError responses carry the message as a plain-text body.
  expect(String(second.body)).toContain("already has a data warehouse");
});

it("lets the project read and write its own database", async ({ expect }) => {
  const { projectId } = await createEntitledProject();
  const { body: credentials } = await provision();

  const create = await clickhouse({
    ...credentials,
    query: `CREATE TABLE "${projectId}".orders (id UInt64, total Float64) ENGINE = MergeTree ORDER BY id`,
  });
  expect(create.status).toBe(200);

  const insert = await clickhouse({
    ...credentials,
    query: `INSERT INTO "${projectId}".orders VALUES (1, 9.99), (2, 42.0)`,
  });
  expect(insert.status).toBe(200);

  const select = await clickhouse({
    ...credentials,
    query: `SELECT count(), sum(total) FROM "${projectId}".orders`,
  });
  expect(select.status).toBe(200);
  expect(select.text).toBe("2\t51.99");
});

it("keeps the project's analytics access, scoped by the pinned project id", async ({ expect }) => {
  await createEntitledProject();
  const { body: credentials } = await provision();

  const analytics = await clickhouse({ ...credentials, query: "SELECT count() FROM default.events" });
  expect(analytics.status).toBe(200);

  // The row-policy inputs are CONST user settings, so a direct connection
  // cannot point itself at another project's analytics rows.
  const override = await clickhouse({
    ...credentials,
    query: "SELECT 1 SETTINGS SQL_project_id = 'some-other-project'",
  });
  expect(override.status).not.toBe(200);
  expect(override.text).toContain("SQL_project_id");
});

it("denies the table engines and table functions that reach outside the instance", async ({ expect }) => {
  const { projectId } = await createEntitledProject();
  const { body: credentials } = await provision();

  const urlEngine = await clickhouse({
    ...credentials,
    query: `CREATE TABLE "${projectId}".exfil (a String) ENGINE = URL('http://example.com', CSV)`,
  });
  expect(urlEngine.status).not.toBe(200);

  const urlFunction = await clickhouse({
    ...credentials,
    query: "SELECT * FROM url('http://example.com', CSV, 'a String')",
  });
  expect(urlFunction.status).not.toBe(200);
});

it("does not let one project read another project's warehouse", async ({ expect }) => {
  const first = await createEntitledProject();
  const { body: firstCredentials } = await provision();
  const created = await clickhouse({
    ...firstCredentials,
    query: `CREATE TABLE "${first.projectId}".secrets (v String) ENGINE = MergeTree ORDER BY v`,
  });
  expect(created.status).toBe(200);
  const inserted = await clickhouse({
    ...firstCredentials,
    query: `INSERT INTO "${first.projectId}".secrets VALUES ('first-project-only')`,
  });
  expect(inserted.status).toBe(200);

  // A second project, with its own warehouse and therefore its own ClickHouse
  // user. This is the test that matters: before per-project users existed,
  // every project shared `limited_user`, and any grant on one project's
  // database would have been readable by all of them.
  const second = await createEntitledProject();
  const { body: secondCredentials } = await provision();

  const direct = await clickhouse({
    ...secondCredentials,
    query: `SELECT * FROM "${first.projectId}".secrets`,
  });
  expect(direct.status).not.toBe(200);
  expect(direct.text).toContain("Not enough privileges");

  // Same check through the API path, which connects as the second project's
  // warehouse user now that it has one.
  const throughApi = await runAnalyticsQuery(`SELECT * FROM "${first.projectId}".secrets`);
  expect(throughApi.status).toBe(400);
  expect(throughApi.body.code).toBe("ANALYTICS_QUERY_ERROR");

  // ...and the second project can still reach its own analytics data.
  const ownAnalytics = await runAnalyticsQuery("SELECT count() AS c FROM events");
  expect(ownAnalytics.status).toBe(200);
  expect(second.projectId).not.toBe(first.projectId);
});

it("can query its own warehouse tables through the analytics endpoint", async ({ expect }) => {
  const { projectId } = await createEntitledProject();
  const { body: credentials } = await provision();
  await clickhouse({
    ...credentials,
    query: `CREATE TABLE "${projectId}".orders (id UInt64) ENGINE = MergeTree ORDER BY id`,
  });
  await clickhouse({ ...credentials, query: `INSERT INTO "${projectId}".orders VALUES (1), (2), (3)` });

  const response = await runAnalyticsQuery(`SELECT count() AS c FROM "${projectId}".orders`);
  expect(response.status).toBe(200);
  expect(response.body.result).toEqual([{ c: 3 }]);
});

it("rotates the password, invalidating the old one and keeping analytics working", async ({ expect }) => {
  const { projectId } = await createEntitledProject();
  const { body: original } = await provision();
  await clickhouse({
    ...original,
    query: `CREATE TABLE "${projectId}".orders (id UInt64) ENGINE = MergeTree ORDER BY id`,
  });

  const rotateResponse = await niceBackendFetch("/api/v1/data-warehouse/rotate-password", {
    method: "POST",
    accessType: "admin",
    body: {},
  });
  expect(rotateResponse.status).toBe(200);
  expect(rotateResponse.body.password).not.toBe(original.password);
  expect(rotateResponse.body.username).toBe(original.username);

  const withOldPassword = await clickhouse({ ...original, query: "SELECT 1" });
  expect(withOldPassword.status).not.toBe(200);

  const withNewPassword = await clickhouse({ ...rotateResponse.body, query: `SELECT count() FROM "${projectId}".orders` });
  expect(withNewPassword.status).toBe(200);

  // The backend reads the stored password per request, so its own connection
  // follows the rotation without any cache to invalidate.
  const analytics = await runAnalyticsQuery("SELECT count() AS c FROM events");
  expect(analytics.status).toBe(200);
});

it("cannot be rotated before it has been provisioned", async ({ expect }) => {
  await createEntitledProject();
  const response = await niceBackendFetch("/api/v1/data-warehouse/rotate-password", {
    method: "POST",
    accessType: "admin",
    body: {},
  });
  expect(response.status).toBe(400);
  expect(String(response.body)).toContain("does not have a data warehouse");
});

it("is not reachable with server auth — provisioning is an admin action", async ({ expect }) => {
  await createEntitledProject();
  const response = await niceBackendFetch("/api/v1/data-warehouse/provision", {
    method: "POST",
    accessType: "server",
    body: {},
  });
  expect(response.status).toBe(401);
});
