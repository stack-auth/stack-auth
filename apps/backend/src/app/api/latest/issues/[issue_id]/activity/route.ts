import { resolveIssueIdentity } from "@/lib/issues/issue-identity";
import { IssueProductInputError, listIssueActivity, type IssueActivityRecord } from "@/lib/issues/issue-product";
import { assertObservabilityEnabled } from "@/lib/issues/observability-gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { IssueActivityRecordSchema, type IssueActivityRecord as IssueActivityRecordJson } from "@hexclave/shared/dist/interface/admin-issues";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { isJsonSerializable, type Json } from "@hexclave/shared/dist/utils/json";

const AuthSchema = yupObject({ type: serverOrHigherAuthTypeSchema.defined(), tenancy: adaptSchema.defined() }).defined();
const ParamsSchema = yupObject({ issue_id: yupString().defined() }).defined();
const ResponseSchema = yupObject({ items: yupArray(IssueActivityRecordSchema).defined() }).defined();

/**
 * The same snake-case/ISO projection `serializeIssueProductSnapshot` applies to
 * its `activities`, for the standalone activity endpoint. Serializing here is
 * not optional: the response pipeline (`smart-response.tsx`) rejects any body
 * that does not round-trip `JSON.stringify`, so returning the internal records
 * with their `Date` fields was a guaranteed 500 once an issue had activity.
 */
function serializeActivityRecord(activity: IssueActivityRecord): IssueActivityRecordJson {
  return {
    id: activity.id,
    actor_user_id: activity.actorUserId,
    type: activity.type,
    idempotency_key: activity.idempotencyKey,
    data: toSharedJson(activity.data, "activity data"),
    occurred_at: activity.occurredAt.toISOString(),
    created_at: activity.createdAt.toISOString(),
  };
}

/**
 * Prisma's `JsonValue` and the shared contract's `Json` are structurally the
 * same wire format, but Prisma types object properties as optional so they are
 * not assignable to each other. Same narrowing as `issue-product-projection`'s
 * `toSharedJson`; a stored JSON column failing this would be data corruption,
 * hence the assertion error rather than a 4xx.
 */
function toSharedJson(value: unknown, fieldName: string): Json {
  if (!isJsonSerializable(value)) {
    throw new HexclaveAssertionError(`Issue ${fieldName} contains a non-JSON value`, { value });
  }
  return value;
}

export const GET = createSmartRouteHandler({
  metadata: { summary: "List issue activity", description: "Returns a bounded, branch-scoped issue activity stream.", tags: ["Issues"] },
  request: yupObject({ auth: AuthSchema, params: ParamsSchema }).defined(),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: ResponseSchema }).defined(),
  async handler({ auth, params }) {
    assertObservabilityEnabled(auth.tenancy);
    // Same identifier grammar as the sibling detail and action routes: uuid or
    // numeric short id, following a merge redirect. `listIssueActivity` itself
    // only accepts the canonical uuid.
    const identity = await resolveIssueIdentity(auth.tenancy, params.issue_id);
    if (identity === null) throw new StatusError(StatusError.NotFound, "Issue not found");
    try {
      const items = await listIssueActivity({ tenancy: auth.tenancy, issueId: identity.issueId });
      return { statusCode: 200, bodyType: "json", body: { items: items.map(serializeActivityRecord) } } as const;
    } catch (error) {
      // Identity resolution already 404'd unknown ids, so this only remains
      // for the row vanishing to a concurrent merge between resolve and list.
      if (error instanceof IssueProductInputError) throw new StatusError(StatusError.NotFound, "Issue not found");
      throw error;
    }
  },
});
