import { describe, expect, it } from "vitest";
import {
  getValidatedTableFilterQuery,
  looksLikeNaturalLanguageQuery,
} from "./search-bar-logic";

describe("looksLikeNaturalLanguageQuery", () => {
  it.each([
    // plain substring searches stay plain
    ["", false],
    ["   ", false],
    ["alice", false],
    ["alice@example.com", false],
    ["no-reply@example.com", false], // single token; "no" cue must not trigger
    ["4c5ba425-6c22-4f65-9e33-3e2b1c5a8d1f", false],
    ["/dashboard/settings", false],
    ["utm_source=google", false], // bare "=" appears in real data values
    ["john smith", false],
    ["page view", false],
    // natural-language conditions go to the AI
    ["users who signed up last week", true],
    ["verified users", true],
    ["more than 5 events", true],
    ["signed up before january", true],
    ["emails that bounced", true],
    ["count > 10", true],
    ["how many users are there?", true],
    ["anything at all?", true], // trailing question mark is always a question
    ["users without a display name", true],
    ["events from the past 3 days", true],
  ])("%j → %s", (input, expected) => {
    expect(looksLikeNaturalLanguageQuery(input)).toBe(expected);
  });
});

describe("getValidatedTableFilterQuery", () => {
  it("accepts a bare SELECT * on the table", () => {
    expect(getValidatedTableFilterQuery("SELECT * FROM users", "users")).toBe(
      "SELECT * FROM users",
    );
  });

  it("accepts WHERE filters, default. prefixes, backticks, and mixed case", () => {
    expect(
      getValidatedTableFilterQuery(
        "select * from default.users where primary_email_verified = 1",
        "users",
      ),
    ).toBe("select * from default.users where primary_email_verified = 1");
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM `users` WHERE signed_up_at >= now() - INTERVAL 7 DAY",
        "users",
      ),
    ).toContain("WHERE signed_up_at");
  });

  it("accepts multi-line queries and strips trailing semicolons", () => {
    expect(
      getValidatedTableFilterQuery(
        "SELECT *\nFROM users\nWHERE is_anonymous = 0;",
        "users",
      ),
    ).toBe("SELECT *\nFROM users\nWHERE is_anonymous = 0");
  });

  it("accepts subqueries inside the WHERE condition", () => {
    const query =
      "SELECT * FROM users WHERE toString(id) IN (SELECT user_id FROM events GROUP BY user_id HAVING count() > 5 LIMIT 100)";
    expect(getValidatedTableFilterQuery(query, "users")).toBe(query);
  });

  it("rejects top-level sorting and pagination while allowing them in subqueries", () => {
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM users ORDER BY signed_up_at DESC",
        "users",
      ),
    ).toBeNull();
    expect(
      getValidatedTableFilterQuery("SELECT * FROM users LIMIT 100", "users"),
    ).toBeNull();
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM users WHERE toString(id) IN (SELECT user_id FROM events ORDER BY event_at DESC LIMIT 100)",
        "users",
      ),
    ).not.toBeNull();
  });

  it("rejects queries on a different table", () => {
    expect(getValidatedTableFilterQuery("SELECT * FROM events", "users")).toBe(null);
    // prefix of another table name must not match
    expect(getValidatedTableFilterQuery("SELECT * FROM users2 WHERE 1", "users")).toBe(null);
    expect(getValidatedTableFilterQuery("SELECT * FROM users_archive", "users")).toBe(null);
  });

  it("rejects anything that could change the column set", () => {
    expect(
      getValidatedTableFilterQuery("SELECT id, primary_email FROM users", "users"),
    ).toBe(null);
    expect(
      getValidatedTableFilterQuery("SELECT count() FROM users", "users"),
    ).toBe(null);
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM users u JOIN events e ON toString(u.id) = e.user_id",
        "users",
      ),
    ).toBe(null);
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM users, events",
        "users",
      ),
    ).toBe(null);
    expect(
      getValidatedTableFilterQuery(
        "SELECT * FROM users GROUP BY id",
        "users",
      ),
    ).toBe(null);
  });

  it("rejects empty and non-SELECT input", () => {
    expect(getValidatedTableFilterQuery("", "users")).toBe(null);
    expect(getValidatedTableFilterQuery(";", "users")).toBe(null);
    expect(getValidatedTableFilterQuery("DROP TABLE users", "users")).toBe(null);
  });
});
