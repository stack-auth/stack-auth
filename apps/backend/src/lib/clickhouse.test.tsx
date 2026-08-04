import { describe, expect, it } from "vitest";
import {
  CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET,
  chunkClickHouseStringIds,
  queryClickHouseByStringIdChunks,
  serializeClickHouseStringArrayParam,
} from "./clickhouse";

describe("ClickHouse string ID chunking", () => {
  it("sorts, deduplicates, and preserves chunk boundaries", () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `project-${(999 - index).toString().padStart(4, "0")}-${"x".repeat(100)}`);
    const chunks = chunkClickHouseStringIds([...ids, ids[0]], "projectIds");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual([...new Set(ids)].sort());
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });

  it("keeps every 50,000-ID chunk within the serialized parameter budget", () => {
    const chunks = chunkClickHouseStringIds(
      Array.from({ length: 50_000 }, (_, index) => `synthetic-project-${index.toString().padStart(7, "0")}`),
      "projectIds",
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => Buffer.byteLength(serializeClickHouseStringArrayParam(chunk), "utf8"))))
      .toBeLessThanOrEqual(CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET);
  });

  it("queries every chunk and concatenates typed rows", async () => {
    const queriedChunks: string[][] = [];
    const client = {
      query: async (params: { query_params?: Record<string, unknown> }) => {
        const ids = params.query_params?.projectIds;
        if (!Array.isArray(ids)) throw new Error("Expected projectIds query parameter");
        queriedChunks.push(ids);
        return {
          json: async () => ids.map((projectId) => ({ projectId })),
        };
      },
    };

    const ids = Array.from({ length: 50_000 }, (_, index) => `project-${index.toString().padStart(5, "0")}`);
    await expect(queryClickHouseByStringIdChunks<{ projectId: string }>(client, {
      query: "SELECT project_id AS projectId",
      parameterName: "projectIds",
      ids,
    })).resolves.toHaveLength(ids.length);
    expect(queriedChunks.length).toBeGreaterThan(1);
    expect(queriedChunks.flat()).toEqual(ids);
  });
});
