/**
 * Keeps end-user personal data out of growth-agent prompts.
 *
 * WHY THIS EXISTS: the growth agent's `sql-query` tool can read the project's analytics tables,
 * which include `users`, `contact_channels`, `team_invitations`, and `team_member_profiles` — so a
 * query like `SELECT primary_email, display_name FROM users LIMIT 200` puts 200 real people's names
 * and addresses into a prompt, which then goes to a third-party inference provider that may retain
 * it. Growth analysis never needs that: it needs counts, rates, and distributions.
 *
 * This is enforced HERE, at the route, rather than inside `lib/growth/analytics-sql.ts` on purpose.
 * That helper is a deliberate mirror of the dashboard AI's `sql-query` tool, where a signed-in human
 * looking at their own users' email addresses is the entire point; folding a growth-only rule into
 * it would make the two behave differently for reasons invisible at the call site. The boundary this
 * protects is "what reaches a prompt", which is a property of the agent route, not of project-scoped
 * query execution.
 *
 * It is a backstop, not the primary control — the tool description already tells the agent to
 * aggregate. It exists because "the model was told not to" is not a security boundary.
 */

/**
 * Column names that carry a direct personal identifier, taken from the live ClickHouse schema in
 * `scripts/clickhouse-migrations.ts` rather than guessed.
 *
 * Matching is on the OUTPUT column name, which gives exactly the behaviour we want for free:
 * `SELECT primary_email FROM users` produces a column literally named `primary_email` and is
 * blocked, while `SELECT domain(primary_email) AS signup_domain ...` produces `signup_domain` and is
 * allowed — and a signup-domain breakdown is the aggregate form of the same question, with the
 * person removed. Aggregation is the way through, which is where we wanted the agent anyway.
 *
 * Deliberately NOT listed: `email_outboxes.subject`, and the various `*_error` columns. They can
 * incidentally contain a name, but they are also how you analyse template performance and delivery
 * failures, and blocking them would cost real analytical ground to catch a rare, indirect leak.
 * That is a judgement call — revisit it if a subject-line convention starts embedding addresses.
 */
const IDENTIFYING_COLUMN_NAMES: ReadonlySet<string> = new Set([
  // users, team_member_profiles
  "primary_email",
  "display_name",
  "profile_image_url",
  // users — free-form blobs the customer controls, so they may hold anything at all
  "client_metadata",
  "client_read_only_metadata",
  "server_metadata",
  "restricted_by_admin_reason",
  "restricted_by_admin_private_details",
  // contact_channels — the address/phone itself
  "value",
  // team_invitations
  "recipient_email",
]);

/**
 * Deliberately loose: this is a "does this look like an address" check over result VALUES, not a
 * validator. It exists to catch what the column-name list cannot — `SELECT primary_email AS x`, a
 * `concat()` of fields, or a new PII column added to the schema after this file was written.
 */
const EMAIL_SHAPED = /[^\s@]+@[^\s@.]+\.[^\s@]+/;

/** How many rows to scan for address-shaped values. */
const VALUE_SCAN_ROW_LIMIT = 50;

/**
 * Returns the output columns that would leak a personal identifier, or an empty array when the
 * result set is safe to hand to a model.
 *
 * Detection is deliberately two-sided, because each half covers the other's blind spot: the name
 * list catches identifiers whose values are not shape-detectable (a display name is just a string),
 * and the value scan catches identifiers hidden behind an alias or expression.
 */
export function findIdentifyingColumns(rows: readonly Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];

  // Union the keys rather than trusting the first row: ClickHouse JSONEachRow omits nothing today,
  // but a column that is null in row 0 and populated later must not slip past on that technicality.
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) columns.add(column);
  }

  const flagged = new Set<string>();
  for (const column of columns) {
    if (IDENTIFYING_COLUMN_NAMES.has(column.toLowerCase())) flagged.add(column);
  }

  for (const row of rows.slice(0, VALUE_SCAN_ROW_LIMIT)) {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value === "string" && EMAIL_SHAPED.test(value)) flagged.add(column);
    }
  }

  return [...flagged].sort();
}

/**
 * The message handed back to the agent when a query is blocked. Phrased as a fixable query problem
 * because that is how the agent already treats `success: false` from this route — it reads the
 * error and rewrites the query — so the outcome is an aggregate rewrite rather than a dead end.
 */
export function buildIdentifyingColumnsError(columns: readonly string[]): string {
  return `This query returns per-person identifying columns (${columns.join(", ")}), which cannot be sent to the analysis model. Aggregate instead of selecting raw rows: count, group, or bucket the identifier rather than returning it (for example \`SELECT domain(primary_email) AS signup_domain, count(*) FROM users GROUP BY signup_domain\`). Identifiers are safe to filter and join on — only returning them is blocked.`;
}
