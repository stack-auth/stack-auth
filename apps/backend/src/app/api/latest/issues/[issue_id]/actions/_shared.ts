import { Prisma } from "@/generated/prisma/client";
import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import type { Tenancy } from "@/lib/tenancies";
import {
  IssueLifecycleInputError,
  IssueNotFoundError,
  type IssueLifecycleStatus,
  type IssueLifecycleTransition,
} from "@/lib/issues/issue-lifecycle";
import { IssueProductInputError } from "@/lib/issues/issue-product";
import { getPrismaClientForTenancy } from "@/prisma-client";
import type { SmartRequest } from "@/route-handlers/smart-request";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";

export const MAX_ACTION_TIMESTAMP_MILLIS = 4_102_444_800_000;
const MAX_ACTION_ISSUE_ID_LENGTH = 64;

export const IssueActionAuthSchema = yupObject({
  type: serverOrHigherAuthTypeSchema.defined(),
  tenancy: adaptSchema.defined(),
}).defined();

export const IssueActionParamsSchema = yupObject({
  issue_id: yupString().nonEmpty().max(MAX_ACTION_ISSUE_ID_LENGTH).defined(),
}).defined();

const ISSUE_ACTIONS = ["assign", "unassign", "resolve", "ignore", "unresolve", "regress", "snooze", "unsnooze"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

const ISSUE_TRANSITION_KINDS = ["status_changed", "status_unchanged", "regressed", "reopened", "occurrence_unchanged"] as const;

export const IssueActionResponseSchema = yupObject({
  action: yupString().oneOf([...ISSUE_ACTIONS]).defined(),
  issue_id: yupString().uuid().defined(),
  redirected: yupBoolean().defined(),
  redirected_from_issue_id: yupString().uuid().nullable().defined(),
  changed: yupBoolean().defined(),
  changed_at_millis: yupNumber().integer().min(0).max(MAX_ACTION_TIMESTAMP_MILLIS).defined(),
  status: yupString().oneOf(["unresolved", "resolved", "ignored"]).nullable().defined(),
  previous_assignee_user_id: yupString().uuid().nullable().defined(),
  assignee_user_id: yupString().uuid().nullable().defined(),
  transition_kind: yupString().oneOf([...ISSUE_TRANSITION_KINDS]).nullable().defined(),
  ignored_until_millis: yupNumber().integer().min(0).max(MAX_ACTION_TIMESTAMP_MILLIS).nullable().defined(),
  regressed_at_millis: yupNumber().integer().min(0).max(MAX_ACTION_TIMESTAMP_MILLIS).nullable().defined(),
}).defined();

export type IssueActionResponse = {
  action: IssueAction,
  issue_id: string,
  redirected: boolean,
  redirected_from_issue_id: string | null,
  changed: boolean,
  changed_at_millis: number,
  status: IssueLifecycleStatus | null,
  previous_assignee_user_id: string | null,
  assignee_user_id: string | null,
  transition_kind: (typeof ISSUE_TRANSITION_KINDS)[number] | null,
  ignored_until_millis: number | null,
  regressed_at_millis: number | null,
};

export type IssueActionTarget = {
  issueId: string,
  redirectedFromIssueId: string | null,
};

function isValidShortId(value: string): boolean {
  if (!/^\d+$/.test(value) || value.length > 19) return false;
  return value.length < 19 || value <= "9223372036854775807";
}

function issueIdentityPredicate(rawIssueId: string): Prisma.Sql {
  if (isValidShortId(rawIssueId)) return Prisma.sql`i."shortId" = ${rawIssueId}::bigint`;
  if (isUuid(rawIssueId)) return Prisma.sql`i."id" = ${rawIssueId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

function redirectIdentityPredicate(rawIssueId: string): Prisma.Sql {
  if (isValidShortId(rawIssueId)) return Prisma.sql`"fromShortId" = ${rawIssueId}::bigint`;
  if (isUuid(rawIssueId)) return Prisma.sql`"fromIssueId" = ${rawIssueId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

/**
 * Resolves the path id on the primary tenant boundary used by the action.
 * Direct rows win over redirects, and redirects are deliberately one hop: the
 * merge writer rewrites inbound redirects, so walking an unbounded chain would
 * turn corrupt redirect data into an unbounded request.
 */
export async function resolveIssueActionTarget(tenancy: Tenancy, rawIssueId: string): Promise<IssueActionTarget | null> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const directRows = await prisma.$replica().$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i."id"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid
      AND ${issueIdentityPredicate(rawIssueId)}
    LIMIT 1
  `);
  const direct = directRows.at(0);
  if (direct !== undefined) return { issueId: direct.id, redirectedFromIssueId: null };

  const redirectRows = await prisma.$replica().$queryRaw<Array<{ fromIssueId: string, toIssueId: string }>>(Prisma.sql`
    SELECT "fromIssueId", "toIssueId"
    FROM "IssueRedirect"
    WHERE "tenancyId" = ${tenancy.id}::uuid
      AND ${redirectIdentityPredicate(rawIssueId)}
    LIMIT 1
  `);
  const redirect = redirectRows.at(0);
  if (redirect === undefined) return null;

  const targetRows = await prisma.$replica().$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i."id"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid
      AND i."id" = ${redirect.toIssueId}::uuid
    LIMIT 1
  `);
  return targetRows.at(0) === undefined
    ? null
    : { issueId: targetRows[0].id, redirectedFromIssueId: redirect.fromIssueId };
}

export function assertIssueActionsEnabled(tenancy: Tenancy): void {
  assertPublicIssueReadEnabled(tenancy);
}

export function actorUserId(fullReq: SmartRequest): string | null {
  return fullReq.auth?.user?.id ?? null;
}

export async function withIssueActionTarget<T>(options: {
  tenancy: Tenancy,
  rawIssueId: string,
  action: (target: IssueActionTarget) => Promise<T>,
}): Promise<{ target: IssueActionTarget, result: T }> {
  // A merge can delete the row after resolution but before the lifecycle
  // helper's lock. Retrying resolution once follows the new redirect without
  // hiding a genuine not-found or retrying an arbitrary failed mutation.
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await resolveIssueActionTarget(options.tenancy, options.rawIssueId);
    if (target === null) throw new StatusError(StatusError.NotFound, "Issue not found");
    try {
      return { target, result: await options.action(target) };
    } catch (error) {
      if (error instanceof IssueNotFoundError && attempt === 0) continue;
      rethrowIssueActionError(error);
    }
  }
  throw new StatusError(StatusError.NotFound, "Issue not found");
}

export function rethrowIssueActionError(error: unknown): never {
  if (error instanceof IssueNotFoundError) {
    throw new StatusError(StatusError.NotFound, "Issue not found");
  }
  if (error instanceof IssueLifecycleInputError) {
    throw new StatusError(StatusError.BadRequest, "Invalid issue action");
  }
  if (error instanceof IssueProductInputError) {
    if (error.message.includes("was not found in the authenticated branch")) {
      throw new StatusError(StatusError.NotFound, "Issue not found");
    }
    throw new StatusError(StatusError.BadRequest, "Invalid issue product action");
  }
  throw error;
}

export function baseActionResponse(options: {
  target: IssueActionTarget,
  action: IssueAction,
  changed: boolean,
  changedAt: Date,
}): IssueActionResponse {
  return {
    action: options.action,
    issue_id: options.target.issueId,
    redirected: options.target.redirectedFromIssueId !== null,
    redirected_from_issue_id: options.target.redirectedFromIssueId,
    changed: options.changed,
    changed_at_millis: options.changedAt.getTime(),
    status: null,
    previous_assignee_user_id: null,
    assignee_user_id: null,
    transition_kind: null,
    ignored_until_millis: null,
    regressed_at_millis: null,
  };
}

export function transitionActionResponse(options: {
  target: IssueActionTarget,
  action: IssueAction,
  transition: IssueLifecycleTransition,
}): IssueActionResponse {
  const response = baseActionResponse({
    target: options.target,
    action: options.action,
    changed: options.transition.kind !== "status_unchanged" && options.transition.kind !== "occurrence_unchanged",
    changedAt: options.transition.at,
  });
  return {
    ...response,
    status: options.transition.current.status,
    transition_kind: options.transition.kind,
    ignored_until_millis: options.transition.current.ignoredUntil?.getTime() ?? null,
    regressed_at_millis: options.transition.current.regressedAt?.getTime() ?? null,
  };
}
