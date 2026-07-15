/**
 * Pure decision logic for the analytics table search bar, kept free of React
 * so the heuristics can be unit-tested exhaustively (see
 * search-bar-logic.test.ts).
 *
 * The search bar is filter-first: typing applies a plain substring (ILIKE)
 * filter over the current table. Only input that a substring match cannot
 * express is routed to the AI, which must respond with a row filter of the
 * shape `SELECT * FROM <table> WHERE ...` so the grid's columns never change.
 */

/**
 * Words that signal the user is describing a CONDITION ("users who signed up
 * last week") rather than typing a substring to match ("alice@example.com").
 * Deliberately excludes anything likely to appear inside real data values —
 * e.g. bare "com" or "www" — since false positives would hijack ordinary
 * searches.
 */
const NATURAL_LANGUAGE_CUES = new Set([
  // question / command words
  "who", "whose", "which", "whom", "what", "when", "how", "why",
  "show", "find", "list", "give", "display", "filter", "get",
  // comparison / quantity words
  "more", "less", "most", "least", "fewer", "greater", "than",
  "under", "over", "above", "below", "between", "top", "bottom", "count",
  // temporal words
  "before", "after", "since", "ago", "during", "past", "last", "first",
  "latest", "newest", "oldest", "recent", "recently", "earlier",
  "today", "yesterday", "tomorrow",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "hour", "hours", "minute", "minutes",
  // state / negation words
  "verified", "unverified", "anonymous", "empty", "missing", "null",
  "never", "ever", "only", "all", "any", "every", "none", "not", "without",
  // relational / auxiliary words common in questions
  "with", "have", "has", "had", "are", "is", "was", "were", "that",
  "contains", "containing", "starts", "ends", "starting", "ending",
  // domain verbs that read as conditions
  "signed", "created", "updated", "joined", "expired", "delivered",
  "opened", "clicked", "bounced", "sent",
  // plural domain nouns — people describe segments with these ("verified
  // users"), while substring searches contain concrete values instead
  "users", "teams", "members", "accounts", "sessions", "invitations",
  "permissions", "channels", "tokens", "emails", "events",
]);

/**
 * Heuristic: does this input look like a natural-language request (→ send to
 * the AI on Enter) rather than a plain substring search (→ keep the live
 * filter)? The zero-results fallback in the search bar catches misses, so
 * this errs on the side of NOT flagging: single-token input (emails, IDs,
 * paths) is never natural language.
 */
export function looksLikeNaturalLanguageQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Comparisons can never be expressed as a substring match. Bare `=` is
  // deliberately NOT a cue — it shows up in legitimate substring searches
  // like URL query params ("utm_source=google").
  if (/[<>]=?|!=/.test(trimmed)) return true;
  if (trimmed.endsWith("?")) return true;
  // Single tokens (emails, UUIDs, paths) are always substring searches, even
  // when their word-fragments happen to hit the cue list ("no-reply@…").
  if (!/\s/.test(trimmed)) return false;
  const words = trimmed.toLowerCase().match(/[a-z']+/g) ?? [];
  const cueCount = words.reduce(
    (count, word) => count + (NATURAL_LANGUAGE_CUES.has(word) ? 1 : 0),
    0,
  );
  return (words.length >= 3 && cueCount >= 1) || cueCount >= 2;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FORBIDDEN_TOP_LEVEL_FILTER_WORDS = new Set([
  "format",
  "having",
  "join",
  "limit",
  "offset",
  "qualify",
  "sample",
  "settings",
  "union",
  "window",
]);

const FORBIDDEN_TOP_LEVEL_FILTER_PAIRS = new Set([
  "group by",
  "into outfile",
  "order by",
  "with fill",
  "with totals",
]);

/**
 * Returns the words visible at SQL parenthesis depth zero, ignoring quoted
 * strings/identifiers. This is deliberately narrower than a SQL parser: the
 * filter contract only needs to distinguish clauses owned by the outer grid
 * from equivalent clauses inside permitted subqueries.
 */
function getTopLevelSqlWords(sql: string): string[] | null {
  const words: string[] = [];
  let currentWord = "";
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;

  const flushWord = () => {
    if (currentWord.length === 0) return;
    words.push(currentWord.toLowerCase());
    currentWord = "";
  };

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;

    if (quote != null) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) {
        if (sql[i + 1] === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      flushWord();
      quote = char;
      continue;
    }

    // Comments are unnecessary in generated row filters and complicate the
    // security boundary by allowing clause-like text to be hidden from this
    // small scanner, so reject them instead of trying to interpret them.
    if (
      char === "#"
      || (char === "-" && sql[i + 1] === "-")
      || (char === "/" && sql[i + 1] === "*")
    ) {
      return null;
    }

    if (char === "(") {
      flushWord();
      depth += 1;
      continue;
    }
    if (char === ")") {
      flushWord();
      depth -= 1;
      if (depth < 0) return null;
      continue;
    }

    if (depth === 0 && /[a-z_]/i.test(char)) {
      currentWord += char;
    } else {
      flushWord();
    }
  }

  flushWord();
  return depth === 0 && quote == null ? words : null;
}

function hasOnlyTopLevelRowFilterClause(filterClause: string): boolean {
  const words = getTopLevelSqlWords(filterClause);
  if (words == null) return false;

  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (FORBIDDEN_TOP_LEVEL_FILTER_WORDS.has(word)) return false;
  }
  for (let i = 1; i < words.length - 1; i++) {
    if (FORBIDDEN_TOP_LEVEL_FILTER_PAIRS.has(`${words[i]!} ${words[i + 1]!}`)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates that an AI-committed query is a pure row filter over the given
 * table, i.e. it cannot change the grid's columns. Accepts
 * `SELECT * FROM [default.]<table>` optionally followed by a WHERE/PREWHERE
 * row filter — anything else (column lists, JOINs, sorting, pagination, other
 * tables) returns null and must not be applied to the grid. Sorting and
 * pagination stay grid-owned so an AI filter cannot silently truncate or
 * reorder the result set before the grid processes it.
 * Subqueries inside the WHERE condition are fine: the `SELECT *` prefix on
 * the outer query is what guarantees the column set stays identical.
 *
 * Returns the query normalized for embedding as a subquery (trailing
 * semicolons stripped — the grid wraps it in `SELECT * FROM (...)`).
 */
export function getValidatedTableFilterQuery(
  query: string,
  tableName: string,
): string | null {
  const normalized = query.trim().replace(/;+\s*$/, "").trim();
  if (normalized.length === 0) return null;
  const collapsed = normalized.replace(/\s+/g, " ");
  const table = escapeRegExp(tableName);
  const bareQueryPattern = new RegExp(
    `^select \\* from (?:default\\.)?\`?${table}\`?$`,
    "i",
  );
  if (bareQueryPattern.test(collapsed)) return normalized;

  const filterQueryPattern = new RegExp(
    `^select \\* from (?:default\\.)?\`?${table}\`? ((?:where|prewhere)\\b.*)$`,
    "i",
  );
  const match = filterQueryPattern.exec(collapsed);
  if (match == null) return null;
  return hasOnlyTopLevelRowFilterClause(match[1]!) ? normalized : null;
}
