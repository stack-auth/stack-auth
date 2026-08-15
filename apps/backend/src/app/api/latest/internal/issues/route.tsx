import { listIssues, type IssueListFilters } from "@/lib/issues/issue-queries";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import {
  ISSUE_LIST_PAGE_SIZE,
  ISSUE_LIST_SORT_FIELDS,
  IssueListResponseSchema,
  type IssueListSortField,
  type IssueStatus,
} from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Mirrors OBSERVABILITY_TIME_RANGES in the dashboard. Enumerated rather than
// free-form because `hours` reaches a raw ClickHouse predicate: an allowlist is
// a cheaper guarantee than trusting a numeric parse.
const ALLOWED_HOURS = [1, 24, 168, 720] as const;
const DEFAULT_HOURS = 24;

function parseHours(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HOURS;
  const value = Number(raw);
  if (!ALLOWED_HOURS.includes(value as (typeof ALLOWED_HOURS)[number])) {
    throw new StatusError(StatusError.BadRequest, `hours must be one of ${ALLOWED_HOURS.join(", ")}`);
  }
  return value;
}

function parseStatus(raw: string | undefined): IssueStatus | "all" {
  if (raw === undefined) return "unresolved";
  if (raw === "all" || raw === "unresolved" || raw === "resolved" || raw === "ignored") return raw;
  throw new StatusError(StatusError.BadRequest, "status must be one of unresolved, resolved, ignored, all");
}

function parseSort(raw: string | undefined): IssueListSortField {
  if (raw === undefined) return "last_seen";
  if (ISSUE_LIST_SORT_FIELDS.includes(raw as IssueListSortField)) return raw as IssueListSortField;
  throw new StatusError(StatusError.BadRequest, `sort must be one of ${ISSUE_LIST_SORT_FIELDS.join(", ")}`);
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return ISSUE_LIST_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new StatusError(StatusError.BadRequest, "limit must be a positive integer");
  }
  return Math.min(value, ISSUE_LIST_PAGE_SIZE);
}

function parseHandled(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === "all") return null;
  if (raw === "handled") return true;
  if (raw === "unhandled") return false;
  throw new StatusError(StatusError.BadRequest, "handled must be one of all, handled, unhandled");
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      hours: yupString().optional(),
      status: yupString().optional(),
      service: yupString().optional(),
      environment: yupString().optional(),
      handled: yupString().optional(),
      search: yupString().optional(),
      sort: yupString().optional(),
      sort_dir: yupString().optional(),
      cursor: yupString().optional(),
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: IssueListResponseSchema,
  }),
  async handler({ auth, query }) {
    const tenancy = auth.tenancy;
    // The observability app owns this surface. Gating here (rather than only in
    // the dashboard) keeps a project that never enabled it from paying for the
    // ClickHouse round trip at all.
    if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    const filters: IssueListFilters = {
      hours: parseHours(query.hours),
      status: parseStatus(query.status),
      serviceName: query.service ?? null,
      environment: query.environment ?? null,
      handled: parseHandled(query.handled),
      search: query.search ?? null,
      sort: parseSort(query.sort),
      sortDir: query.sort_dir === "asc" ? "asc" : "desc",
      cursor: query.cursor ?? null,
      limit: parseLimit(query.limit),
    };

    const result = await listIssues({ tenancy, filters });

    return {
      statusCode: 200,
      bodyType: "json",
      body: result,
    } as const;
  },
});
