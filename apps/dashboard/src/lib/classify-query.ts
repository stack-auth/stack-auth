/**
 * Classifies whether user input is a ClickHouse SQL query or a natural language prompt.
 * Used to prioritize "Run Query" vs "Ask AI" in the command center.
 */
export function classifyClickHouseSqlVsPrompt(input: unknown): {
  kind: "sql" | "prompt",
  confidence: number,
  reasons: string[],
  score?: { sql: number, prompt: number, margin: number },
} {
  const raw = (input ?? "").toString();
  const s = raw.trim();

  if (!s) {
    return { kind: "prompt", confidence: 0.5, reasons: ["empty"] };
  }

  // Strip code fences if someone pasted markdown
  const unfenced = s.replace(/^```[\w-]*\n([\s\S]*?)\n```$/m, "$1").trim();

  const lower = unfenced.toLowerCase();
  const words = lower.match(/[a-z_]+/g) ?? [];
  const wordSet = new Set(words);

  let sql = 0;
  let prompt = 0;
  const reasons: string[] = [];

  // 1) Strong starts (high signal)
  const startsWithSqlKeyword = /^(with|select|insert|update|delete|alter|create|drop|truncate|describe|desc|explain|use|set)\b/i.test(unfenced);
  const showEnglishLead = /^show\s+(me|us|my|our|your|them|him|her)\b/i.test(unfenced);
  const showHasSqlTarget = /^show\s+(tables?|databases?|columns?|create|processlist|functions?|settings|grants|roles|quotas|dictionary|dictionaries|clusters|indexes|partitions|privileges|users?)\b/i.test(unfenced);
  const startsWithShowSql = /^show\b/i.test(unfenced) && showHasSqlTarget && !showEnglishLead;
  const startsWithSql = startsWithSqlKeyword || startsWithShowSql;
  if (startsWithSql) {
    sql += 3;
    reasons.push("starts-with-sql-keyword");
  }

  // 2) Structural patterns (very strong)
  const hasSelectFrom = /\bselect\b[\s\S]{0,300}\bfrom\b/i.test(unfenced);
  if (hasSelectFrom) {
    sql += 4;
    reasons.push("select-from-structure");
  }

  const hasInsertInto = /\binsert\b[\s\S]{0,80}\binto\b/i.test(unfenced);
  if (hasInsertInto) {
    sql += 4;
    reasons.push("insert-into-structure");
  }

  // 3) Common SQL clauses
  const clauseHits = [
    "where", "group", "order", "limit", "having", "join", "on", "union", "distinct", "values", "format", "settings"
  ].filter(k => wordSet.has(k));
  if (clauseHits.length) {
    sql += Math.min(3, clauseHits.length);
    reasons.push("sql-clauses:" + clauseHits.join(","));
  }

  // 4) ClickHouse-ish tokens (extra signal)
  const chHits = [
    "prewhere", "final", "sample", "array", "engine", "partition", "ttl", "distributed", "merge", "replacing", "collapsing",
    "materialized", "view", "database", "table", "cluster"
  ].filter(k => wordSet.has(k));
  if (chHits.length) {
    sql += 2;
    reasons.push("clickhouse-ish:" + chHits.join(","));
  }

  // 5) Operator / punctuation density
  const opCount = (unfenced.match(/(<=|>=|!=|=|<|>|\b(in|like|ilike|between|and|or)\b)/gi) ?? []).length;
  if (opCount >= 2) {
    sql += 2;
    reasons.push("many-operators");
  } else if (opCount === 1) {
    sql += 1;
    reasons.push("some-operators");
  }

  const punct = (unfenced.match(/[(),;*]/g) ?? []).length;
  const punctRatio = punct / Math.max(1, unfenced.length);
  if (punctRatio > 0.03) {
    sql += 1;
    reasons.push("sql-punctuation-density");
  }

  // 6) Identifier-ish things
  if (/`[^`]+`/.test(unfenced) || /"[^"]+"\."[^"]+"/.test(unfenced)) {
    sql += 1;
    reasons.push("quoted-identifiers");
  }
  if (/\b[a-z_]+\.[a-z_]+\b/i.test(unfenced)) {
    sql += 1;
    reasons.push("dot-identifiers");
  }
  if (/--|\/\*/.test(unfenced)) {
    sql += 1;
    reasons.push("sql-comments");
  }

  // Prompt-ish features
  if (/[?]\s*$/.test(unfenced)) {
    prompt += 2;
    reasons.push("ends-with-question-mark");
  }
  if (/\b(please|could you|can you|what|why|how|explain|help)\b/i.test(unfenced)) {
    prompt += 2;
    reasons.push("prompt-words");
  }

  // If it's mostly letters/spaces and barely any operators, lean prompt.
  const symbolChars = (unfenced.match(/[^a-z0-9_\s]/gi) ?? []).length;
  const symbolRatio = symbolChars / Math.max(1, unfenced.length);
  if (symbolRatio < 0.06 && opCount === 0 && !startsWithSql) {
    prompt += 2;
    reasons.push("low-symbol-low-operator");
  }

  // Avoid the classic false positive: "select ..." in English without any SQL structure
  if (/^select\b/i.test(unfenced) && !hasSelectFrom && clauseHits.length === 0 && opCount === 0) {
    prompt += 3;
    reasons.push("english-select-false-positive-guard");
  }

  const margin = sql - prompt;
  const kind = margin >= 2 ? "sql" : "prompt";

  // Confidence: squish margin into [0.5..0.99]
  const confidence = Math.max(0.5, Math.min(0.99, 0.5 + Math.abs(margin) * 0.12));

  return { kind, confidence, reasons, score: { sql, prompt, margin } };
}
