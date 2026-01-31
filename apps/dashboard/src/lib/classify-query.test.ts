import { describe, expect, it } from "vitest";
import { classifyClickHouseSqlVsPrompt } from "./classify-query";

describe("classifyClickHouseSqlVsPrompt", () => {
  describe("SQL queries", () => {
    it("should classify basic SELECT query as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE user_id = 1 LIMIT 10");
      expect(result.kind).toBe("sql");
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reasons).toContain("select-from-structure");
    });

    it("should classify SELECT with GROUP BY as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT event_type, COUNT(*) FROM events GROUP BY event_type");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("select-from-structure");
    });

    it("should classify INSERT statement as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("INSERT INTO events (user_id, event_type) VALUES (1, 'click')");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("insert-into-structure");
    });

    it("should classify CREATE TABLE as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("CREATE TABLE users (id UInt64, name String) ENGINE = MergeTree()");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("starts-with-sql-keyword");
    });

    it("should classify query with ClickHouse-specific keywords", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events FINAL PREWHERE event_at > now() - INTERVAL 1 DAY");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("clickhouse-ish:prewhere,final");
    });

    it("should classify query with quoted identifiers", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT `user_id`, `event_type` FROM `events`");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("quoted-identifiers");
    });

    it("should classify query with dot notation", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT e.user_id FROM events e");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("dot-identifiers");
    });

    it("should classify SHOW TABLES as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SHOW TABLES");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("starts-with-sql-keyword");
    });

    it("should classify DESCRIBE as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("DESCRIBE events");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("starts-with-sql-keyword");
    });

    it("should classify query with SQL comments as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events -- get all events");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("sql-comments");
    });
  });

  describe("Natural language prompts", () => {
    it("should classify question about writing query as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("can you write me a clickhouse query to count events by day?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("ends-with-question-mark");
      expect(result.reasons).toContain("prompt-words");
    });

    it("should classify 'select the best option please' as prompt (false positive guard)", () => {
      const result = classifyClickHouseSqlVsPrompt("select the best option please");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("english-select-false-positive-guard");
      expect(result.reasons).toContain("prompt-words");
    });

    it("should classify help request as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("help me understand how to query events");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("prompt-words");
    });

    it("should classify 'what is' question as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("what is the schema of the events table?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("prompt-words");
      expect(result.reasons).toContain("ends-with-question-mark");
    });

    it("should classify simple text without operators as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("show me user activity");
      expect(result.kind).toBe("prompt");
    });

    it("should classify request with 'please' as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("please get me the latest events");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("prompt-words");
    });

    it("should classify 'how to' question as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("how do I join two tables in ClickHouse?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("prompt-words");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty input", () => {
      const result = classifyClickHouseSqlVsPrompt("");
      expect(result.kind).toBe("prompt");
      expect(result.confidence).toBe(0.5);
      expect(result.reasons).toContain("empty");
    });

    it("should handle null input", () => {
      const result = classifyClickHouseSqlVsPrompt(null);
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("empty");
    });

    it("should handle undefined input", () => {
      const result = classifyClickHouseSqlVsPrompt(undefined);
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("empty");
    });

    it("should strip markdown code fences", () => {
      const result = classifyClickHouseSqlVsPrompt("```sql\nSELECT * FROM events\n```");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("select-from-structure");
    });

    it("should handle whitespace-only input", () => {
      const result = classifyClickHouseSqlVsPrompt("   ");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("empty");
    });
  });

  describe("Confidence scoring", () => {
    it("should have higher confidence for clear SQL", () => {
      const sqlResult = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE user_id = 1 LIMIT 10");
      const promptResult = classifyClickHouseSqlVsPrompt("can you write me a query?");

      expect(sqlResult.confidence).toBeGreaterThan(0.7);
      expect(promptResult.confidence).toBeGreaterThan(0.5);
    });

    it("should return score breakdown", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events");
      expect(result.score).toBeDefined();
      expect(result.score?.sql).toBeGreaterThan(0);
      expect(result.score?.margin).toBeDefined();
    });
  });
});
