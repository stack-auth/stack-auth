import { createTemplateComponentFromHtml, renderEmailWithTemplate } from "@/lib/email-rendering";
import { getEmailConfig, sendEmail } from "@/lib/emails";
import { getNotificationCategoryByName, hasNotificationEnabled } from "@/lib/notification-categories";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { unsubscribeLinkVerificationCodeHandler } from "../unsubscribe-link/verification-handler";

type UserResult = {
  user_id: string,
  user_email?: string,
  success: boolean,
  error?: string,
};

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
      user_ids: yupArray(yupString().defined()).defined(),
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
      results: yupArray(yupObject({
        user_id: yupString().defined(),
        user_email: yupString().optional(),
        success: yupBoolean().defined(),
        error: yupString().optional(),
      })).defined(),
    }).defined(),
  }),
  handler: async ({ body, auth }) => {
    if (!getEnvVariable("STACK_FREESTYLE_API_KEY")) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }
    if (auth.tenancy.config.email_config.type === "shared") {
      throw new StatusError(400, "Cannot send custom emails when using shared email config");
    }
    const emailConfig = await getEmailConfig(auth.tenancy);
    const notificationCategory = getNotificationCategoryByName(body.notification_category_name);
    if (!notificationCategory) {
      throw new StatusError(404, "Notification category not found");
    }
    const themeList = auth.tenancy.completeConfig.emails.themes;
    if (!Object.keys(themeList).includes(auth.tenancy.completeConfig.emails.selectedThemeId)) {
      throw new StatusError(400, "No active theme found");
    }
    const activeTheme = themeList[auth.tenancy.completeConfig.emails.selectedThemeId];

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const users = await prisma.projectUser.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: {
          in: body.user_ids,
        },
      },
      include: {
        contactChannels: true,
      },
    });
    const userMap = new Map(users.map(user => [user.projectUserId, user]));
    const userSendErrors: Map<string, string> = new Map();
    const userPrimaryEmails: Map<string, string> = new Map();

    for (const userId of body.user_ids) {
      const user = userMap.get(userId);
      if (!user) {
        userSendErrors.set(userId, "User not found");
        continue;
      }
      const isNotificationEnabled = await hasNotificationEnabled(auth.tenancy, user.projectUserId, notificationCategory.id);
      if (!isNotificationEnabled) {
        userSendErrors.set(userId, "User has disabled notifications for this category");
        continue;
      }
      const primaryEmail = user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value;
      if (!primaryEmail) {
        userSendErrors.set(userId, "User does not have a primary email");
        continue;
      }
      userPrimaryEmails.set(userId, primaryEmail);

      let unsubscribeLink: string | null = null;
      if (notificationCategory.can_disable) {
        const { code } = await unsubscribeLinkVerificationCodeHandler.createCode({
          tenancy: auth.tenancy,
          method: {},
          data: {
            user_id: user.projectUserId,
            notification_category_id: notificationCategory.id,
          },
          callbackUrl: undefined
        });
        const unsubUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
        unsubUrl.pathname = "/api/v1/emails/unsubscribe-link";
        unsubUrl.searchParams.set("code", code);
        unsubscribeLink = unsubUrl.toString();
      }


      const template = createTemplateComponentFromHtml(body.html, unsubscribeLink || undefined);
      const renderedEmail = await renderEmailWithTemplate(
        template,
        activeTheme.tsxSource,
        {
          user: { displayName: user.displayName },
          project: { displayName: auth.tenancy.project.display_name },
        },
      );
      if (renderedEmail.status === "error") {
        userSendErrors.set(userId, "There was an error rendering the email");
        continue;
      }

      try {
        await sendEmail({
          tenancyId: auth.tenancy.id,
          emailConfig,
          to: primaryEmail,
          subject: body.subject,
          html: renderedEmail.data.html,
          text: renderedEmail.data.text,
        });
      } catch {
        userSendErrors.set(userId, "Failed to send email");
      }
    }

    const results: UserResult[] = body.user_ids.map((userId) => ({
      user_id: userId,
      user_email: userPrimaryEmails.get(userId),
      success: !userSendErrors.has(userId),
      error: userSendErrors.get(userId),
    }));

    return {
      statusCode: 200,
      bodyType: 'json',
      body: { results },
    };
  },
});
