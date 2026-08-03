import { getApiUrlForRequest } from "@/lib/request-api-url";
import { createBrowserAction, DEFAULT_BROWSER_ACTION_TTL_MS, DEFAULT_IMPERSONATION_SESSION_TTL_MS, MAX_BROWSER_ACTION_TTL_MS } from "@/lib/browser-actions";
import { MAX_AUTH_SESSION_EXPIRATION_MS } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      type: yupString().oneOf(["impersonation", "clickmap-overlay"]).defined(),
      origin: yupString().defined(),
      expires_in_millis: yupNumber().integer().min(1).max(MAX_BROWSER_ACTION_TTL_MS).default(DEFAULT_BROWSER_ACTION_TTL_MS),
      session_expires_in_millis: yupNumber().integer().min(1).max(MAX_AUTH_SESSION_EXPIRATION_MS).default(DEFAULT_IMPERSONATION_SESSION_TTL_MS),
      user_id: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      url: yupString().defined(),
      expires_at_millis: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth: { tenancy }, body: { type, origin, expires_in_millis, session_expires_in_millis, user_id } }, fullReq) => {
    if (type === "impersonation" && user_id == null) {
      throw new StatusError(StatusError.BadRequest, "Invalid browser action");
    }
    const actionParams = type === "impersonation"
      ? { type, params: { userId: user_id ?? throwErr(new StatusError(StatusError.BadRequest, "Invalid browser action")) } }
      : { type, params: {} };
    const action = await createBrowserAction({
      tenancy,
      origin,
      expiresInMillis: expires_in_millis,
      sessionExpiresInMillis: session_expires_in_millis,
      apiUrl: getApiUrlForRequest(fullReq),
      ...actionParams,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: action.id,
        url: action.url,
        expires_at_millis: action.expiresAtMillis,
      },
    };
  },
});
