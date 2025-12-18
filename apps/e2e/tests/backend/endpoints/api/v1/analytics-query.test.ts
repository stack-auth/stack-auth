import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

it("can execute a basic query with admin access", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT 1 as value",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [{ "value": 1 }],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute a query with parameters", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT {test_param:String} as value",
      params: {
        test_param: "hello world",
      },
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [{ "value": "hello world" }],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute a query with custom timeout", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT 1 as value",
      timeout_ms: 5000,
    },
  });

  expect(response.status).toBe(200);
  expect(response.body).toMatchInlineSnapshot(`
    {
      "result": [{ "value": 1 }],
      "stats": {
        "cpu_time": <stripped field 'cpu_time'>,
        "wall_clock_time": <stripped field 'wall_clock_time'>,
      },
    }
  `);
});

it("validates required query field", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {},
  });

  expect(response).toMatchInlineSnapshot(`
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
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "INVALID SQL QUERY",
    },
  });

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
        The query failed to execute: Syntax error: failed at position 1 (INVALID) (line 1, col 1): INVALID SQL QUERY 
        FORMAT JSONEachRow. Expected one of: Query, Query with output, EXPLAIN, EXPLAIN, SELECT query, possibly with UNION, list of union elements, SELECT query, subquery, possibly with UNION, SELECT subquery, SELECT query, WITH, FROM, SELECT, SHOW CREATE QUOTA query, SHOW CREATE, SHOW [FULL] [TEMPORARY] TABLES|DATABASES|CLUSTERS|CLUSTER|MERGES 'name' [[NOT] [I]LIKE 'str'] [LIMIT expr], SHOW, SHOW COLUMNS query, SHOW ENGINES query, SHOW ENGINES, SHOW FUNCTIONS query, SHOW FUNCTIONS, SHOW INDEXES query, SHOW SETTING query, SHOW SETTING, EXISTS or SHOW CREATE query, EXISTS, DESCRIBE FILESYSTEM CACHE query, DESCRIBE, DESC, DESCRIBE query, SHOW PROCESSLIST query, SHOW PROCESSLIST, CREATE TABLE or ATTACH TABLE query, CREATE, ATTACH, REPLACE, CREATE DATABASE query, CREATE VIEW query, CREATE DICTIONARY, CREATE LIVE VIEW query, CREATE WINDOW VIEW query, ALTER query, ALTER TABLE, ALTER TEMPORARY TABLE, ALTER DATABASE, RENAME query, RENAME DATABASE, RENAME TABLE, EXCHANGE TABLES, RENAME DICTIONARY, EXCHANGE DICTIONARIES, RENAME, DROP query, DROP, DETACH, TRUNCATE, UNDROP query, UNDROP, CHECK ALL TABLES, CHECK TABLE, KILL QUERY query, KILL, OPTIMIZE query, OPTIMIZE TABLE, WATCH query, WATCH, SHOW ACCESS query, SHOW ACCESS, ShowAccessEntitiesQuery, SHOW GRANTS query, SHOW GRANTS, SHOW PRIVILEGES query, SHOW PRIVILEGES, BACKUP or RESTORE query, BACKUP, RESTORE, INSERT query, INSERT INTO, USE query, USE, SET ROLE or SET DEFAULT ROLE query, SET ROLE DEFAULT, SET ROLE, SET DEFAULT ROLE, SET query, SET, SYSTEM query, SYSTEM, CREATE USER or ALTER USER query, ALTER USER, CREATE USER, CREATE ROLE or ALTER ROLE query, ALTER ROLE, CREATE ROLE, CREATE QUOTA or ALTER QUOTA query, ALTER QUOTA, CREATE QUOTA, CREATE ROW POLICY or ALTER ROW POLICY query, ALTER POLICY, ALTER ROW POLICY, CREATE POLICY, CREATE ROW POLICY, CREATE SETTINGS PROFILE or ALTER SETTINGS PROFILE query, ALTER SETTINGS PROFILE, ALTER PROFILE, CREATE SETTINGS PROFILE, CREATE PROFILE, CREATE FUNCTION query, DROP FUNCTION query, CREATE WORKLOAD query, DROP WORKLOAD query, CREATE RESOURCE query, DROP RESOURCE query, CREATE NAMED COLLECTION, DROP NAMED COLLECTION query, Alter NAMED COLLECTION query, ALTER, CREATE INDEX query, DROP INDEX query, DROP access entity query, MOVE access entity query, MOVE, GRANT or REVOKE query, REVOKE, GRANT, CHECK GRANT, CHECK GRANT, TCL query, BEGIN TRANSACTION, START TRANSACTION, COMMIT, ROLLBACK, SET TRANSACTION SNAPSHOT, Delete query, DELETE, Update query, UPDATE, COPY query, COPY. 
      \`,
    }
  `);
});

it("can execute query returning multiple rows", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT arrayJoin([0, 1, 2]) AS number",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          { "number": 0 },
          { "number": 1 },
          { "number": 2 },
        ],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute query with multiple parameters", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT {param1:String} as col1, {param2:String} as col2",
      params: {
        param1: "value1",
        param2: "value2",
      },
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "col1": "value1",
            "col2": "value2",
          },
        ],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can execute query and hit custom timeout", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT sleep(3)",
      timeout_ms: 100,
    },
  });

  expect(response.status).toBe(400);
  expect(response.headers).toMatchInlineSnapshot(`
    Headers {
      "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
      <some fields may have been hidden>,
    }
  `);
  expect(response.body.code).toBe("ANALYTICS_QUERY_ERROR");

});

it("sets SQL_project_id and SQL_branch_id settings in query", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT getSetting('SQL_project_id') AS project_id, getSetting('SQL_branch_id') AS branch_id;",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "branch_id": "main",
            "project_id": "<stripped UUID>",
          },
        ],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("does not allow CREATE TABLE", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "CREATE TABLE IF NOT EXISTS test_table (id UUID) ENGINE = MergeTree() ORDER BY id;",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TABLE ON analytics.test_table. " },
        "error": "The query failed to execute: limited_user: Not enough privileges. To execute this query, it's necessary to have the grant CREATE TABLE ON analytics.test_table. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow querying system tables", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT number FROM system.numbers LIMIT 1",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. " },
        "error": "The query failed to execute: limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(number) ON system.numbers. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow killing queries", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "KILL QUERY WHERE query_id = '00000000-0000-0000-0000-000000000000'",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query_id, user, query) ON system.processes. " },
        "error": "The query failed to execute: limited_user: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(query_id, user, query) ON system.processes. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("does not allow INSERT statements", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "INSERT INTO system.one (dummy) VALUES (0)",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_QUERY_ERROR",
        "details": { "error": "limited_user: Not enough privileges. To execute this query, it's necessary to have the grant INSERT(dummy) ON system.one. " },
        "error": "The query failed to execute: limited_user: Not enough privileges. To execute this query, it's necessary to have the grant INSERT(dummy) ON system.one. ",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_QUERY_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
