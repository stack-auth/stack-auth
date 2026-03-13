import { sendSupportFeedbackEmail } from "@/lib/internal-feedback-emails";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Submit support feedback",
    description: "Send a support feedback message to the internal Stack Auth inbox",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    body: yupObject({
      name: yupString().optional(),
      email: emailSchema.defined().nonEmpty(),
      message: yupString().defined().nonEmpty(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    await sendSupportFeedbackEmail({
      tenancy: auth.tenancy,
      user: auth.user,
      name: body.name ?? null,
      email: body.email,
      message: body.message,
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
