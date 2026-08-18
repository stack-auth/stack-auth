import { Prisma } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const ISSUE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isIssueUuid(value: string): boolean {
  return ISSUE_UUID_PATTERN.test(value);
}

/**
 * The ONE canonical resolver for a user-supplied issue identifier (the
 * `[issue_id]` path segment, bulk-action ids, …). It accepts three forms:
 *   - a uuid (the primary key),
 *   - an all-digits short id (what the UI shows and what people paste in chat),
 *   - either of the above for an issue that has since been merged away, via
 *     `IssueRedirect`.
 *
 * The short-id form is why this is a lookup rather than a `findUnique`: short
 * ids are per-tenancy `BigInt`s, so `42` is only meaningful together with the
 * authenticated tenancy.
 *
 * This used to be implemented four times (public detail, internal detail,
 * issue actions, bulk actions) with subtly drifted validation. Any new surface
 * that accepts an issue identifier must resolve it through this module so the
 * accepted grammar cannot fork again.
 */

/**
 * Matches the dashboard's `parseIssueRouteId` exactly: digits only, no leading
 * zeros. Leading zeros would resolve to a different string than the id the API
 * minted, so "0042" is a miss rather than a normalization opportunity (short
 * ids start at 1, so this also rejects a plain "0"). The length/value guard
 * rejects anything above 2^63-1 BEFORE it can reach a `::bigint` cast, which
 * would otherwise turn an over-long digit string into a Postgres cast error
 * (i.e. a 500 instead of a 400).
 */
export function isValidShortId(raw: string): boolean {
  if (!/^[1-9]\d*$/.test(raw) || raw.length > 19) return false;
  // "9223372036854775807" is 2^63-1; at equal length the lexicographic
  // comparison agrees with the numeric one because both strings are all digits
  // with no leading zeros.
  return raw.length < 19 || raw <= "9223372036854775807";
}

// Two distinct predicates rather than one clause with a runtime branch: the
// columns have different types (`bigint` vs `uuid`), so a single query would
// have to cast one of them per row and lose its index.
function issueIdentityPredicate(rawId: string): Prisma.Sql {
  if (isValidShortId(rawId)) return Prisma.sql`i."shortId" = ${rawId}::bigint`;
  if (isIssueUuid(rawId)) return Prisma.sql`i."id" = ${rawId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

// Short ids resolve through redirects too. They are the ids users actually
// type and paste into chat, so a merged-away short id 404ing would break
// exactly the links people share — which is why `IssueRedirect` carries
// `fromShortId` with its own unique constraint.
function issueRedirectPredicate(rawId: string): Prisma.Sql {
  if (isValidShortId(rawId)) return Prisma.sql`"fromShortId" = ${rawId}::bigint`;
  if (isIssueUuid(rawId)) return Prisma.sql`"fromIssueId" = ${rawId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

export type ResolvedIssueIdentity = {
  /** Canonical uuid of the surviving issue row. */
  issueId: string,
  /**
   * Non-null when the requested id was a merged-away issue. Always the
   * merged-away ISSUE's uuid, not the raw input — the input may have been a
   * short id, and this field's whole purpose is letting the dashboard rewrite
   * the URL to the surviving issue.
   */
  redirectedFromIssueId: string | null,
};

/**
 * Resolves an identifier only inside the authenticated tenancy. Returns `null`
 * for a well-formed id that does not exist there (a valid id owned by a
 * foreign tenant is intentionally indistinguishable from a missing one) and
 * throws 400 for an id that is neither a uuid nor a valid short id.
 *
 * Redirects are followed exactly ONE hop by design — merge rewrites inbound
 * redirects rather than chaining them, so a chain would indicate corrupt data
 * rather than a state to traverse, and walking it would hide that (or, for an
 * accidental cycle, hang the request).
 *
 * Ordinary lookups go through `$replica()`: identity resolution is read-only,
 * and every mutation that follows re-checks the canonical id against the
 * primary in its own `WHERE tenancyId/id` clause. Callers that use the result as
 * read-after-write proof can request a primary read explicitly.
 */
export async function resolveIssueIdentity(
  tenancy: Tenancy,
  rawId: string,
  options: { consistency?: "replica" | "primary" } = {},
): Promise<ResolvedIssueIdentity | null> {
  if (!isValidShortId(rawId) && !isIssueUuid(rawId)) {
    throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
  }

  const prisma = await getPrismaClientForTenancy(tenancy);
  // Merge retries run immediately after a write and use the result as proof
  // that a specific lifecycle event already committed. A replica can lag and
  // report the old live issue instead, so that proof must opt into the primary.
  // All ordinary identity lookups remain replica-routed by default.
  const readClient = options.consistency === "primary" ? prisma : prisma.$replica();
  const directRows = await readClient.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT i."id"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid
      AND ${issueIdentityPredicate(rawId)}
    LIMIT 1
  `);
  const direct = directRows.at(0);
  if (direct !== undefined) return { issueId: direct.id, redirectedFromIssueId: null };

  const redirectRows = await readClient.$queryRaw<{ fromIssueId: string, toIssueId: string }[]>(Prisma.sql`
    SELECT "fromIssueId", "toIssueId"
    FROM "IssueRedirect"
    WHERE "tenancyId" = ${tenancy.id}::uuid
      AND ${issueRedirectPredicate(rawId)}
    LIMIT 1
  `);
  const redirect = redirectRows.at(0);
  if (redirect === undefined) return null;

  // The one explicit hop: verify the redirect target actually exists rather
  // than trusting the redirect row (the survivor may itself have been deleted).
  const targetRows = await readClient.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT i."id"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid
      AND i."id" = ${redirect.toIssueId}::uuid
    LIMIT 1
  `);
  const target = targetRows.at(0);
  return target === undefined
    ? null
    : { issueId: target.id, redirectedFromIssueId: redirect.fromIssueId };
}
