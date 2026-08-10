import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import {
  deleteSavedIssueSearchViewForActor,
  getSavedIssueSearchViewResponse,
  updateSavedIssueSearchViewResponse,
} from "@/lib/issues/saved-search-views/api";
import {
  SavedIssueSearchViewMutationSchema,
  SavedIssueSearchViewResponseSchema,
} from "@/lib/issues/saved-search-views/contract";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  SavedIssueSearchViewAuthSchema,
  SavedIssueSearchViewMutationAuthSchema,
  savedIssueSearchViewActorUserId,
  savedIssueSearchViewMutationAuthorization,
} from "../_shared";

const SavedIssueSearchViewParamsSchema = yupObject({
  view_id: yupString().uuid().defined(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get a saved issue search view",
    description: "Returns one saved issue-search filter only when it is visible in the authenticated project branch.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: SavedIssueSearchViewAuthSchema,
    params: SavedIssueSearchViewParamsSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: SavedIssueSearchViewResponseSchema,
  }),
  async handler({ auth, params }, fullReq) {
    assertPublicIssueReadEnabled(auth.tenancy);
    const view = await getSavedIssueSearchViewResponse({
      tenancy: auth.tenancy,
      actorUserId: savedIssueSearchViewActorUserId(fullReq),
      viewId: params.view_id,
    });
    if (view === null) throw new StatusError(StatusError.NotFound, "Saved issue search view not found");
    return {
      statusCode: 200,
      bodyType: "json",
      body: view,
    };
  },
});

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: "Update a saved issue search view",
    description: "Updates a saved issue-search filter only when the authenticated user owns it or the caller has explicit admin access.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: SavedIssueSearchViewMutationAuthSchema,
    params: SavedIssueSearchViewParamsSchema,
    body: SavedIssueSearchViewMutationSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: SavedIssueSearchViewResponseSchema,
  }),
  async handler({ auth, params, body }, fullReq) {
    assertPublicIssueReadEnabled(auth.tenancy);
    return {
      statusCode: 200,
      bodyType: "json",
      body: await updateSavedIssueSearchViewResponse({
        tenancy: auth.tenancy,
        authorization: savedIssueSearchViewMutationAuthorization(fullReq),
        viewId: params.view_id,
        body,
      }),
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Delete a saved issue search view",
    description: "Deletes a saved issue-search filter only when the authenticated user owns it or the caller has explicit admin access.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: SavedIssueSearchViewMutationAuthSchema,
    params: SavedIssueSearchViewParamsSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([204]).defined(),
    bodyType: yupString().oneOf(["empty"]).defined(),
  }),
  async handler({ auth, params }, fullReq) {
    assertPublicIssueReadEnabled(auth.tenancy);
    await deleteSavedIssueSearchViewForActor({
      tenancy: auth.tenancy,
      authorization: savedIssueSearchViewMutationAuthorization(fullReq),
      viewId: params.view_id,
    });
    return {
      statusCode: 204,
      bodyType: "empty",
    };
  },
});
