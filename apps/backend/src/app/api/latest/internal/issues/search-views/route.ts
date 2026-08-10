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
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import {
  InternalSavedIssueSearchViewAuthSchema,
  internalSavedIssueSearchViewActorUserId,
} from "./_shared";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List dashboard issue search views",
    description: "Lists bounded project-visible issue-search views in the authenticated project branch. Private views require a real end-user identity and are intentionally omitted from normal admin-key dashboard requests.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: InternalSavedIssueSearchViewAuthSchema,
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
        actorUserId: internalSavedIssueSearchViewActorUserId(fullReq),
        limit: parseSavedIssueSearchViewListLimit(query.limit),
      }),
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Create a dashboard issue search view",
    description: "Creates a bounded project-visible issue-search view in the authenticated project branch. Private views are rejected when the admin request has no real end-user identity.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
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
        actorUserId: internalSavedIssueSearchViewActorUserId(fullReq),
        body,
      }),
    };
  },
});
