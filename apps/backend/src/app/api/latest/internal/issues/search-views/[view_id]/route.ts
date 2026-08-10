import { assertPublicIssueReadEnabled } from "@/lib/issues/public-issue-api";
import {
  deleteSavedIssueSearchViewForActor,
  getSavedIssueSearchViewResponse,
  updateSavedIssueSearchViewResponse,
} from "@/lib/issues/saved-search-views/api";
import { createSavedIssueSearchViewMutationAuthorization } from "@/lib/issues/saved-search-views/persistence";
import {
  SavedIssueSearchViewMutationSchema,
  SavedIssueSearchViewResponseSchema,
} from "@/lib/issues/saved-search-views/contract";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  InternalSavedIssueSearchViewAuthSchema,
  internalSavedIssueSearchViewActorUserId,
} from "../_shared";

const SavedIssueSearchViewParamsSchema = yupObject({
  view_id: yupString().uuid().defined(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Get a dashboard issue search view",
    description: "Returns one issue-search view only when it is visible in the authenticated project branch.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: InternalSavedIssueSearchViewAuthSchema,
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
      actorUserId: internalSavedIssueSearchViewActorUserId(fullReq),
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
    hidden: true,
    summary: "Update a dashboard issue search view",
    description: "Updates one issue-search view for the authenticated dashboard admin. Existing private-view ownership is retained; no owner is inferred from an admin key.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
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
        authorization: createSavedIssueSearchViewMutationAuthorization({
          authType: "admin",
          actorUserId: internalSavedIssueSearchViewActorUserId(fullReq),
        }),
        viewId: params.view_id,
        body,
      }),
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Delete a dashboard issue search view",
    description: "Deletes one issue-search view for the authenticated dashboard admin within the authenticated project branch.",
    tags: ["Issues"],
  },
  request: yupObject({
    auth: InternalSavedIssueSearchViewAuthSchema,
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
      authorization: createSavedIssueSearchViewMutationAuthorization({
        authType: "admin",
        actorUserId: internalSavedIssueSearchViewActorUserId(fullReq),
      }),
      viewId: params.view_id,
    });
    return {
      statusCode: 204,
      bodyType: "empty",
    };
  },
});
