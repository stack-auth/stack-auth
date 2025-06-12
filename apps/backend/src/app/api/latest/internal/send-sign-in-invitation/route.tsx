import { sendEmailFromTemplate } from "@/lib/emails";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, emailSchema, serverOrHigherAuthTypeSchema, urlSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send an email to invite a user to a team",
    description: "The user receiving this email can join the team by clicking on the link in the email. If the user does not have an account yet, they will be prompted to create one.",
    tags: ["Teams"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      email: emailSchema.defined(),
      callback_url: urlSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!validateRedirectUrl(body.callback_url, auth.tenancy.config.domains, auth.tenancy.config.allow_localhost)) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }

    await sendEmailFromTemplate({
      email: body.email,
      tenancy: auth.tenancy,
      user: null,
      templateType: "sign_in_invitation",
      extraVariables: {
        signInInvitationLink: body.callback_url,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
