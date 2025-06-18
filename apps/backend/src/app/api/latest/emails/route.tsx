import { getEmailConfig, sendEmail } from "@/lib/emails";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getUser } from "../users/crud";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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
      user_id: yupString().defined(),
      html: yupString().defined(),
      subject: yupString().defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ body, auth }) => {
    const user = await getUser({ userId: body.user_id, tenancyId: auth.tenancy.id });
    if (!user) {
      throw new StatusError(404, "User not found");
    }
    if (!user.primary_email) {
      throw new StatusError(400, "User does not have a primary email");
    }
    if (auth.tenancy.config.email_config.type === "shared") {
      throw new StatusError(400, "Cannot send custom emails when using shared email config");
    }

    await sendEmail({
      tenancyId: auth.tenancy.id,
      emailConfig: await getEmailConfig(auth.tenancy),
      to: user.primary_email,
      subject: body.subject,
      html: body.html,
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        success: true,
      },
    };
  },
});
