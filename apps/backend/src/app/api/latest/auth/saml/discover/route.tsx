import { discoverConnectionByEmail } from "@/saml/discovery";
import type { SamlConnectionConfig } from "@/saml/saml";
import { getSoleTenancyFromProjectBranch, DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { emailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Email-domain → SAML connection lookup for the client SDK's
 * signInWithSso({ email }) flow. Returns the matching connection's id +
 * displayName so the customer's UI can show e.g. "Sign in with Acme SSO"
 * before redirecting.
 *
 * Returns 404 (rather than 200 with null) when no connection matches —
 * the SDK relies on the status to fall back to other sign-in methods.
 */
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Discover SAML connection by email",
    description: "Returns the SAML connection matching the email's domain, if any.",
    tags: ["Saml"],
  },
  request: yupObject({
    query: yupObject({
      email: emailSchema.defined(),
      project_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      connection_id: yupString().defined(),
      display_name: yupString().defined(),
    }).defined(),
  }),
  async handler({ query }) {
    const tenancy = await getSoleTenancyFromProjectBranch(query.project_id, DEFAULT_BRANCH_ID, true);
    if (!tenancy) {
      throw new StatusError(StatusError.NotFound, `Project ${query.project_id} not found`);
    }
    const samlConfig = (tenancy.config.auth as { saml?: { connections?: Record<string, SamlConnectionConfig> } }).saml;
    const connections = samlConfig?.connections ?? {};
    const matched = discoverConnectionByEmail(connections, query.email);
    if (!matched) {
      throw new StatusError(StatusError.NotFound, "No SAML connection matches this email's domain");
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        connection_id: matched.id,
        display_name: matched.displayName,
      },
    };
  },
});
