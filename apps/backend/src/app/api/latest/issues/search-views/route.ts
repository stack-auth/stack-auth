import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import {
  createSavedIssueSearchViewResponse,
  listSavedIssueSearchViewResponses,
  parseSavedIssueSearchViewListLimit,
} from "@/lib/issues/saved-search-views/api";
import {
  SavedIssueSearchViewListResponseSchema,
  SavedIssueSearchViewMutationSchema,
  SavedIssueSearchViewResponseSchema,
} from "@/lib/issues/saved-search-views/contract";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { SavedIssueSearchViewAuthSchema, savedIssueSearchViewActorUserId } from "./_shared";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List saved issue search views",
    description: "Lists bounded saved issue-search filters visible in the authenticated project branch. Private views are returned only to their owner; project views are branch-scoped.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: SavedIssueSearchViewAuthSchema,
    query: yupObject({
      limit: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: SavedIssueSearchViewListResponseSchema,
  }),
  async handler({ auth, query }, fullReq) {
    assertPublicIssueReadEnabled(auth.tenancy);
    return {
      statusCode: 200,
      bodyType: "json",
      body: await listSavedIssueSearchViewResponses({
        tenancy: auth.tenancy,
        actorUserId: savedIssueSearchViewActorUserId(fullReq),
        limit: parseSavedIssueSearchViewListLimit(query.limit),
      }),
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a saved issue search view",
    description: "Creates a versioned, bounded saved issue-search filter in the authenticated project branch. The body cannot provide tenancy, project, branch, or owner identifiers.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: SavedIssueSearchViewMutationSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: SavedIssueSearchViewResponseSchema,
  }),
  async handler({ auth, body }, fullReq) {
    assertPublicIssueReadEnabled(auth.tenancy);
    return {
      statusCode: 201,
      bodyType: "json",
      body: await createSavedIssueSearchViewResponse({
        tenancy: auth.tenancy,
        actorUserId: savedIssueSearchViewActorUserId(fullReq),
        body,
      }),
    };
  },
});
