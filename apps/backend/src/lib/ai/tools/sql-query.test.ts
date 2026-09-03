import { describe, expect, it } from "vitest";
import { getTools } from ".";
import { createSqlQueryTool } from "./sql-query";

describe("createSqlQueryTool", () => {
  it("does not create a SQL tool without an explicit project target", () => {
    expect(createSqlQueryTool(null)).toBeNull();
    expect(createSqlQueryTool(undefined)).toBeNull();
  });

  it("creates a SQL tool for an explicit project target", () => {
    expect(createSqlQueryTool("00000000-0000-0000-0000-000000000000")).not.toBeNull();
  });
});

describe("getTools", () => {
  it("omits queryAnalytics when sql-query has no explicit project target", async () => {
    await expect(getTools(["sql-query"], {
      auth: null,
      targetProjectId: null,
    })).resolves.toEqual({});
  });

  it("includes queryAnalytics when sql-query has an explicit project target", async () => {
    const tools = await getTools(["sql-query"], {
      auth: null,
      targetProjectId: "00000000-0000-0000-0000-000000000000",
    });

    expect(tools).toHaveProperty("queryAnalytics");
  });
});
