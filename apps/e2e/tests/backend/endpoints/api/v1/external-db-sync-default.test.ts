import { DEFAULT_CLICKHOUSE_EXTERNAL_DB_ID } from "@stackframe/stack-shared/dist/config/schema";
import { describe, expect } from "vitest";
import { test } from "../../../../helpers";
import { Project, niceBackendFetch } from "../../../backend-helpers";
import { buildClickhouseConnectionString } from "./external-db-sync-utils";

async function fetchRenderedConfig() {
  const res = await niceBackendFetch("/api/latest/internal/config", {
    accessType: "admin",
  });
  expect(res.status).toBe(200);
  return JSON.parse(res.body.config_string);
}

describe.sequential("Default external ClickHouse mapping", () => {
  test("default mapping is injected and immutable", async () => {
    await Project.createAndSwitch({
      display_name: "Default ClickHouse mapping",
    });

    const initialConfig = await fetchRenderedConfig();
    expect(initialConfig.dbSync).toMatchInlineSnapshot(`
      {
        "externalDatabases": {
          "stack-auth-clickhouse": {
            "connectionString": "http://stackframe:PASSWORD-PLACEHOLDER--9gKyMxJeMx@localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>33/analytics",
            "type": "clickhouse",
          },
        },
      }
    `);

    await Project.updateConfig({ "dbSync.externalDatabases": {} });
    const afterDeleteAttempt = await fetchRenderedConfig();
    expect(afterDeleteAttempt.dbSync).toMatchInlineSnapshot(`
      {
        "externalDatabases": {
          "stack-auth-clickhouse": {
            "connectionString": "http://stackframe:PASSWORD-PLACEHOLDER--9gKyMxJeMx@localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>33/analytics",
            "type": "clickhouse",
          },
        },
      }
    `);

    await Project.updateConfig({
      "dbSync.externalDatabases": {
        [DEFAULT_CLICKHOUSE_EXTERNAL_DB_ID]: {
          type: "postgres",
          connectionString: "postgres://override-should-be-ignored",
        },
        extra_db: {
          type: "clickhouse",
          connectionString: "http://user:pass@example.com/analytics",
        },
      },
    });
    const afterOverrideAttempt = await fetchRenderedConfig();

    expect(afterOverrideAttempt.dbSync.externalDatabases[DEFAULT_CLICKHOUSE_EXTERNAL_DB_ID]).toMatchObject({
      type: "clickhouse",
      connectionString: buildClickhouseConnectionString(process.env.STACK_CLICKHOUSE_DATABASE ?? "analytics"),
    });
    expect(afterOverrideAttempt.dbSync.externalDatabases.extra_db).toMatchObject({
      type: "clickhouse",
      connectionString: "http://user:pass@example.com/analytics",
    });
  });
});
