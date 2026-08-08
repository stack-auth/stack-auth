import { getProjectOAuthInteraction, recordProjectOAuthDecision } from "@/lib/project-oauth-interaction";
import { isTrustedClient } from "@/lib/project-oauth-provider";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({
  type: clientOrHigherAuthTypeSchema.defined(),
  project: adaptSchema.defined(),
  tenancy: adaptSchema.defined(),
  user: adaptSchema.defined(),
}).defined();

const paramsSchema = yupObject({
  project_id: yupString().defined(),
  interaction_uid: yupString().defined(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Read project OAuth interaction",
    description: "Read safe presentation data for a project OAuth interaction",
    tags: ["OAuth"],
  },
  request: yupObject({ auth: authSchema, params: paramsSchema }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      client: yupObject({ id: yupString().defined(), display_name: yupString().defined() }).defined(),
      scopes: yupArray(yupObject({
        scope: yupString().defined(),
        display_name: yupString().defined(),
        description: yupString().defined(),
      }).defined()).defined(),
      resource: yupObject({ uri: yupString().defined(), display_name: yupString().defined() }).nullable().defined(),
      trusted_client: yupBoolean().defined(),
      allow_user_to_deselect_optional_scopes: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    if (auth.project.id !== params.project_id) throw new StatusError(404, "Project not found");
    const interaction = await getProjectOAuthInteraction(auth.tenancy, params.interaction_uid);
    if (interaction === undefined) throw new StatusError(404, "This authorization request has expired.");

    const config = auth.tenancy.config.oauthProvider;
    const scopes = interaction.requestedScopes.map(scope => {
      const configured = Object.values(config.scopes).find(value => value.scope === scope);
      return {
        scope,
        display_name: configured?.displayName
          ?? (scope.startsWith("team_perm:") ? `Team permission: ${scope.slice("team_perm:".length)}` : scope.startsWith("perm:") ? `Permission: ${scope.slice("perm:".length)}` : scope),
        description: configured?.description ?? "Access requested by this application.",
      };
    });
    const resourceConfig = interaction.resource === undefined
      ? undefined
      : Object.values(config.resources).find(resource => resource.uri === interaction.resource);
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        client: {
          id: interaction.clientId,
          display_name: getOrUndefined(config.clients, interaction.clientId)?.displayName ?? interaction.clientId,
        },
        scopes,
        resource: interaction.resource === undefined
          ? null
          : { uri: interaction.resource, display_name: resourceConfig?.displayName ?? interaction.resource },
        trusted_client: isTrustedClient(auth.tenancy, interaction.clientId),
        // oidc-provider resumes the original scope request, so a reduced grant causes a prompt
        // loop. Keep this capability visibly disabled until reduced-scope continuation is supported.
        allow_user_to_deselect_optional_scopes: false,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Complete project OAuth interaction",
    description: "Record an authenticated user's project OAuth decision",
    tags: ["OAuth"],
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
    body: yupObject({
      approved_scopes: yupArray(yupString().defined()).defined(),
      denied: yupBoolean().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ done_url: yupString().defined() }).defined(),
  }),
  handler: async ({ auth, params, body }, fullReq) => {
    if (auth.project.id !== params.project_id) throw new StatusError(404, "Project not found");
    const userId = fullReq.auth?.user?.id ?? throwErr("OAuth interaction completion requires an authenticated user");
    const doneUrl = await recordProjectOAuthDecision({
      tenancy: auth.tenancy,
      uid: params.interaction_uid,
      userId,
      approvedScopes: body.approved_scopes,
      denied: body.denied,
    });
    return { statusCode: 200, bodyType: "json", body: { done_url: doneUrl } };
  },
});
