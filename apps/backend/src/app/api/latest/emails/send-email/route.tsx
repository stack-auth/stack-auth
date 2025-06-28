import { getEmailConfig, sendEmail } from "@/lib/emails";
import { getNotificationCategoryByName, hasNotificationEnabled } from "@/lib/notification-categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getUser } from "../../users/crud";
import { unsubscribeLinkVerificationCodeHandler } from "../unsubscribe-link/verification-handler";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

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
      notification_category_name: yupString().defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      user_email: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ body, auth }) => {
    if (auth.tenancy.config.email_config.type === "shared") {
      throw new StatusError(400, "Cannot send custom emails when using shared email config");
    }
    const user = await getUser({ userId: body.user_id, tenancyId: auth.tenancy.id });
    if (!user) {
      throw new StatusError(404, "User not found");
    }
    if (!user.primary_email) {
      throw new StatusError(400, "User does not have a primary email");
    }
    const notificationCategory = getNotificationCategoryByName(body.notification_category_name);
    if (!notificationCategory) {
      throw new StatusError(404, "Notification category not found");
    }
    const isNotificationEnabled = await hasNotificationEnabled(auth.tenancy.id, user.id, notificationCategory.id);
    if (!isNotificationEnabled) {
      throw new StatusError(400, "User has disabled notifications for this category");
    }

    let html = body.html;
    if (notificationCategory.can_disable) {
      const { code } = await unsubscribeLinkVerificationCodeHandler.createCode({
        tenancy: auth.tenancy,
        method: {},
        data: {
          user_id: user.id,
          notification_category_id: notificationCategory.id,
        },
        callbackUrl: undefined
      });
      const unsubscribeLink = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
      unsubscribeLink.pathname = "/api/v1/emails/unsubscribe-link";
      unsubscribeLink.searchParams.set("code", code);
      html += `<br /><a href="${unsubscribeLink.toString()}">Click here to unsubscribe</a>`;
    }

    await sendEmail({
      tenancyId: auth.tenancy.id,
      emailConfig: await getEmailConfig(auth.tenancy),
      to: user.primary_email,
      subject: body.subject,
      html,
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        user_email: user.primary_email,
      },
    };
  },
});
