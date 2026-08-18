import { assertObservabilityEnabled } from "@/lib/issues/observability-gate";
import type { SmartRequest } from "@/route-handlers/smart-request";
import {
  createSmartRouteHandler,
  type SmartRouteHandlerOverloadMetadata,
} from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  adminAuthTypeSchema,
  clientOrHigherAuthTypeSchema,
  serverOrHigherAuthTypeSchema,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  createSavedIssueSearchViewResponse,
  deleteSavedIssueSearchViewForActor,
  getSavedIssueSearchViewResponse,
  listSavedIssueSearchViewResponses,
  parseSavedIssueSearchViewListLimit,
  updateSavedIssueSearchViewResponse,
} from "./api";
import {
  SavedIssueSearchViewListResponseSchema,
  SavedIssueSearchViewMutationSchema,
  SavedIssueSearchViewResponseSchema,
} from "./contract";
import { createSavedIssueSearchViewMutationAuthorization } from "./persistence";

/**
 * The public (`/issues/search-views`, machine keys) and internal
 * (`/internal/issues/search-views`, dashboard admin) trees expose the same five
 * CRUD operations over the same persistence layer. This factory exists so the
 * two trees can't drift apart: the only real differences between them are the
 * accepted auth types and the OpenAPI metadata (the internal tree is hidden and
 * worded for the dashboard), so those are the only knobs.
 */
type SavedIssueSearchViewAuthTypeSchema =
  | typeof adminAuthTypeSchema
  | typeof clientOrHigherAuthTypeSchema
  | typeof serverOrHigherAuthTypeSchema;

export type SavedIssueSearchViewRouteHandlerOptions = {
  /**
   * Auth types accepted by list/get/create. The public tree uses
   * server-or-higher (machine keys act for the project), the internal tree
   * admin only.
   */
  authTypeSchema: SavedIssueSearchViewAuthTypeSchema,
  /**
   * Auth types accepted by update/delete. Deliberately looser than
   * `authTypeSchema` on the public tree (client-or-higher): ownership is
   * enforced per-row by the mutation authorization below, so an end user may
   * mutate their own private views even though they cannot list or create.
   */
  mutationAuthTypeSchema: SavedIssueSearchViewAuthTypeSchema,
  /** Full per-operation OpenAPI metadata; the trees differ in wording and `hidden`. */
  metadata: {
    list: SmartRouteHandlerOverloadMetadata,
    create: SmartRouteHandlerOverloadMetadata,
    get: SmartRouteHandlerOverloadMetadata,
    update: SmartRouteHandlerOverloadMetadata,
    delete: SmartRouteHandlerOverloadMetadata,
  },
};

const SavedIssueSearchViewParamsSchema = yupObject({
  view_id: yupString().uuid().defined(),
}).defined();

function savedIssueSearchViewAuthSchema(typeSchema: SavedIssueSearchViewAuthTypeSchema) {
  return yupObject({
    type: typeSchema.defined(),
    tenancy: adaptSchema.defined(),
  }).defined();
}

/**
 * Admin-key requests normally have no end-user identity. Returning null here
 * is deliberate: the persistence layer then exposes and creates only
 * project-visible views. We must not turn the dashboard's admin key into a
 * fake private-view owner, because that would make every dashboard operator
 * share one indistinguishable private namespace.
 */
export function savedIssueSearchViewActorUserId(fullReq: SmartRequest): string | null {
  return fullReq.auth?.user?.id ?? null;
}

/**
 * Derives the mutation authorization from the authenticated request. Reading
 * `fullReq.auth.type` (instead of a per-tree hardcoded auth type) is exact for
 * both trees because each tree's request auth schema already constrains which
 * auth types can reach this point — the internal tree only admits "admin", so
 * this always yields the admin authorization there.
 */
function savedIssueSearchViewMutationAuthorization(fullReq: SmartRequest) {
  if (fullReq.auth === null) {
    throw new StatusError(StatusError.Forbidden, "saved issue search view mutation requires authenticated access");
  }
  return createSavedIssueSearchViewMutationAuthorization({
    authType: fullReq.auth.type,
    actorUserId: savedIssueSearchViewActorUserId(fullReq),
  });
}

export function createSavedIssueSearchViewListRoute(options: SavedIssueSearchViewRouteHandlerOptions) {
  return createSmartRouteHandler({
    metadata: options.metadata.list,
    request: yupObject({
      auth: savedIssueSearchViewAuthSchema(options.authTypeSchema),
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
      assertObservabilityEnabled(auth.tenancy);
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
}

export function createSavedIssueSearchViewCreateRoute(options: SavedIssueSearchViewRouteHandlerOptions) {
  return createSmartRouteHandler({
    metadata: options.metadata.create,
    request: yupObject({
      auth: savedIssueSearchViewAuthSchema(options.authTypeSchema),
      body: SavedIssueSearchViewMutationSchema,
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([201]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: SavedIssueSearchViewResponseSchema,
    }),
    async handler({ auth, body }, fullReq) {
      assertObservabilityEnabled(auth.tenancy);
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
}

export function createSavedIssueSearchViewGetRoute(options: SavedIssueSearchViewRouteHandlerOptions) {
  return createSmartRouteHandler({
    metadata: options.metadata.get,
    request: yupObject({
      auth: savedIssueSearchViewAuthSchema(options.authTypeSchema),
      params: SavedIssueSearchViewParamsSchema,
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: SavedIssueSearchViewResponseSchema,
    }),
    async handler({ auth, params }, fullReq) {
      assertObservabilityEnabled(auth.tenancy);
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
}

export function createSavedIssueSearchViewUpdateRoute(options: SavedIssueSearchViewRouteHandlerOptions) {
  return createSmartRouteHandler({
    metadata: options.metadata.update,
    request: yupObject({
      auth: savedIssueSearchViewAuthSchema(options.mutationAuthTypeSchema),
      params: SavedIssueSearchViewParamsSchema,
      body: SavedIssueSearchViewMutationSchema,
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: SavedIssueSearchViewResponseSchema,
    }),
    async handler({ auth, params, body }, fullReq) {
      assertObservabilityEnabled(auth.tenancy);
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
}

export function createSavedIssueSearchViewDeleteRoute(options: SavedIssueSearchViewRouteHandlerOptions) {
  return createSmartRouteHandler({
    metadata: options.metadata.delete,
    request: yupObject({
      auth: savedIssueSearchViewAuthSchema(options.mutationAuthTypeSchema),
      params: SavedIssueSearchViewParamsSchema,
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([204]).defined(),
      bodyType: yupString().oneOf(["empty"]).defined(),
    }),
    async handler({ auth, params }, fullReq) {
      assertObservabilityEnabled(auth.tenancy);
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
}
