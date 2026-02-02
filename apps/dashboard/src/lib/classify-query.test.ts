import { describe, expect, it } from "vitest";
import { classifyClickHouseSqlVsPrompt } from "./classify-query";

describe("classifyClickHouseSqlVsPrompt", () => {
  describe("SQL queries with uppercase keywords", () => {
    it("should classify uppercase SELECT query as SQL with high confidence", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE user_id = 1 LIMIT 10");
      expect(result.kind).toBe("sql");
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reasons).toContain("select-from-structure-with-sql-syntax");
      expect(result.reasons).toContain("sql-star-operator");
    });

    it("should classify SELECT with GROUP BY as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT event_type, COUNT(*) FROM events GROUP BY event_type");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("select-from-structure-with-sql-syntax");
    });

    it("should classify query with ClickHouse-specific keywords", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events FINAL PREWHERE event_at > now() - INTERVAL 1 DAY");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("clickhouse-ish:prewhere,final,interval");
    });

    it("should classify query with backtick identifiers", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT `user_id`, `event_type` FROM `events`");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("backtick-identifiers");
    });

    it("should classify query with multiple dot notations", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT e.user_id, e.event_type FROM events e");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("multiple-dot-notations");
    });

    it("should classify SHOW TABLES as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SHOW TABLES");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("starts-with-uppercase-sql-keyword");
    });

    it("should classify DESCRIBE as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("DESCRIBE events");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("starts-with-uppercase-sql-keyword");
    });

    it("should classify query with SQL comments as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events -- get all events");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("sql-comments");
    });

    it("should classify query ending with semicolon as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events;");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("ends-with-semicolon");
    });

    it("should classify query with comparison operators as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE count >= 10 AND status != 'deleted'");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("sql-comparison-operators");
    });
  });

  describe("Natural language prompts", () => {
    it("should classify question about writing query as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("can you write me a clickhouse query to count events by day?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("ends-with-question-mark");
    });

    it("should classify 'select the best option please' as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("select the best option please");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("select-without-from");
    });

    it("should classify help request as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("help me understand how to query events");
      expect(result.kind).toBe("prompt");
    });

    it("should classify 'what is' question as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("what is the schema of the events table?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("ends-with-question-mark");
    });

    it("should classify 'show me user activity' as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("show me user activity");
      expect(result.kind).toBe("prompt");
    });

    it("should classify request with 'please' as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("please get me the latest events");
      expect(result.kind).toBe("prompt");
    });

    it("should classify 'how to' question as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("how do I join two tables in ClickHouse?");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("ends-with-question-mark");
    });

    it("should classify English sentence with 'select' and 'from' as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("select all events from the table from the last 24 hours");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("english-phrase-pattern");
    });

    it("should classify conversational request as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("could you show me the events from yesterday");
      expect(result.kind).toBe("prompt");
    });

    it("should classify long natural language as prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("I want to find all the users who signed up in the last week and see their activity");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("long-sentence-no-sql-structure");
    });
  });

  describe("Readonly mode", () => {
    it("should treat INSERT as prompt in readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "INSERT INTO events (user_id, event_type) VALUES (1, 'click')",
        { readonlyOnly: true }
      );
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("mutating-statement-in-readonly-mode");
    });

    it("should treat UPDATE as prompt in readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "UPDATE events SET status = 'active' WHERE id = 1",
        { readonlyOnly: true }
      );
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("mutating-statement-in-readonly-mode");
    });

    it("should treat DELETE as prompt in readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "DELETE FROM events WHERE id = 1",
        { readonlyOnly: true }
      );
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("mutating-statement-in-readonly-mode");
    });

    it("should treat CREATE TABLE as prompt in readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "CREATE TABLE users (id UInt64, name String) ENGINE = MergeTree()",
        { readonlyOnly: true }
      );
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("mutating-statement-in-readonly-mode");
    });

    it("should allow INSERT in non-readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "INSERT INTO events (user_id, event_type) VALUES (1, 'click')",
        { readonlyOnly: false }
      );
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("insert-into-structure");
    });

    it("should allow SELECT in readonly mode", () => {
      const result = classifyClickHouseSqlVsPrompt(
        "SELECT * FROM events LIMIT 10",
        { readonlyOnly: true }
      );
      expect(result.kind).toBe("sql");
    });
  });

  describe("Uppercase vs lowercase", () => {
    it("should score uppercase keywords higher than lowercase", () => {
      const uppercaseResult = classifyClickHouseSqlVsPrompt("SELECT * FROM events");
      const lowercaseResult = classifyClickHouseSqlVsPrompt("select * from events");

      expect(uppercaseResult.kind).toBe("sql");
      expect(lowercaseResult.kind).toBe("sql");
      // Uppercase should have higher score
      expect(uppercaseResult.score!.sql).toBeGreaterThan(lowercaseResult.score!.sql);
    });

    it("should treat lowercase 'select' without structure as likely prompt", () => {
      const result = classifyClickHouseSqlVsPrompt("select something good for me");
      expect(result.kind).toBe("prompt");
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
    });

    it("should handle whitespace-only input", () => {
      const result = classifyClickHouseSqlVsPrompt("   ");
      expect(result.kind).toBe("prompt");
      expect(result.reasons).toContain("empty");
    });
  });

  describe("Confidence scoring", () => {
    it("should have higher confidence for clear uppercase SQL", () => {
      const sqlResult = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE user_id = 1 LIMIT 10");
      expect(sqlResult.confidence).toBeGreaterThan(0.7);
    });

    it("should return score breakdown", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events");
      expect(result.score).toBeDefined();
      expect(result.score?.sql).toBeGreaterThan(0);
      expect(result.score?.margin).toBeDefined();
    });
  });

  describe("SQL-specific operators", () => {
    it("should recognize SELECT * as SQL-specific", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events");
      expect(result.reasons).toContain("sql-star-operator");
    });

    it("should recognize table.column notation as SQL", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT events.id, events.type FROM events");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("multiple-dot-notations");
    });

    it("should recognize = operator as SQL signal", () => {
      const result = classifyClickHouseSqlVsPrompt("SELECT * FROM events WHERE status = 'active'");
      expect(result.kind).toBe("sql");
      expect(result.reasons).toContain("equals-operator");
    });
  });
});
