import { approveProjectOAuthInteraction, getProjectOAuthInteractionDetails } from "@/lib/project-oauth-provider";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared/dist/known-errors";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    query: yupObject({ interaction_uid: yupString().defined() }).defined(),
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      client_id: yupString().defined(),
      client_name: yupString().defined(),
      scopes: yupArray(yupString().defined()).defined(),
      resource: yupString().nullable().defined(),
      trusted: yupBoolean().defined(),
    }).defined(),
  }).defined(),
  handler: async (req, fullReq) => {
    if (fullReq.auth === null || fullReq.auth.type !== "client" || fullReq.auth.user === undefined) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    const projectId = fullReq.params.project_id;
    if (projectId === undefined || projectId !== fullReq.auth.project.id) throw new StatusError(400, "Invalid interaction.");
    const details = await getProjectOAuthInteractionDetails(fullReq.auth.tenancy, req.query.interaction_uid, fullReq.auth.user.id);
    if (details === undefined) throw new StatusError(400, "Invalid interaction.");
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        client_id: details.clientId,
        client_name: details.clientName,
        scopes: details.scopes,
        resource: details.resource ?? null,
        trusted: details.trusted,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      interaction_uid: yupString().defined(),
    }).defined(),
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      code: yupString().defined(),
    }).defined(),
  }).defined(),
  handler: async (req, fullReq) => {
    if (fullReq.auth === null || fullReq.auth.type !== "client" || fullReq.auth.user === undefined) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    const projectId = fullReq.params.project_id;
    if (projectId === undefined || projectId !== fullReq.auth.project.id) {
      throw new StatusError(400, "Invalid interaction.");
    }
    const result = await approveProjectOAuthInteraction(
      fullReq.auth.tenancy,
      req.body.interaction_uid,
      fullReq.auth.user.id,
    );
    if (result.status === "invalid") {
      throw new StatusError(400, "Invalid interaction.");
    }
    return { statusCode: 200, bodyType: "json", body: { code: result.code } };
  },
});
