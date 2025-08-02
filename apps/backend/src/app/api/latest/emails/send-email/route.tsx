import { createTemplateComponentFromHtml, getEmailThemeForTemplate, renderEmailWithTemplate } from "@/lib/email-rendering";
import { getEmailConfig, sendEmail } from "@/lib/emails";
import { getNotificationCategoryByName, hasNotificationEnabled } from "@/lib/notification-categories";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, templateThemeIdSchema, yupArray, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { unsubscribeLinkVerificationCodeHandler } from "../unsubscribe-link/verification-handler";
import { KnownErrors } from "@stackframe/stack-shared";

type UserResult = {
  user_id: string,
  user_email?: string,
};

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send email",
    description: "Send an email to a list of users. The content field should contain either {html, subject, notification_category_name} for HTML emails or {template_id, variables} for template-based emails.",
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      user_ids: yupArray(yupString().defined()).defined(),
      theme_id: templateThemeIdSchema.nullable().meta({
        openapiField: { description: "The theme to use for the email. If not specified, the default theme will be used." }
      }),
      html: yupString().optional(),
      subject: yupString().optional(),
      notification_category_name: yupString().optional(),
      template_id: yupString().optional(),
      variables: yupRecord(yupString(), yupMixed()).optional(),
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
      })).defined(),
    }).defined(),
  }),
  handler: async ({ body, auth }) => {
    if (!getEnvVariable("STACK_FREESTYLE_API_KEY")) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }
    if (auth.tenancy.config.emails.server.isShared) {
      throw new KnownErrors.RequiresCustomEmailServer();
    }
    if (!body.html && !body.template_id) {
      throw new KnownErrors.SchemaError("Either html or template_id must be provided");
    }
    if (body.html && (body.template_id || body.variables)) {
      throw new KnownErrors.SchemaError("If html is provided, cannot provide template_id or variables");
    }
    const emailConfig = await getEmailConfig(auth.tenancy);
    const defaultNotificationCategory = getNotificationCategoryByName(body.notification_category_name ?? "Transactional") ?? throwErr(400, "Notification category not found with given name");
    const themeSource = getEmailThemeForTemplate(auth.tenancy, body.theme_id);
    const templates = new Map(Object.entries(auth.tenancy.config.emails.templates));
    const templateSource = body.template_id
      ? (templates.get(body.template_id)?.tsxSource ?? throwErr(400, "Template not found with given id"))
      : createTemplateComponentFromHtml(body.html!);

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
    const missingUserIds = body.user_ids.filter(userId => !users.some(user => user.projectUserId === userId));
    if (missingUserIds.length > 0) {
      throw new KnownErrors.UserIdDoesNotExist(missingUserIds[0]);
    }
    const userMap = new Map(users.map(user => [user.projectUserId, user]));
    const userSendErrors: Map<string, string> = new Map();
    const userPrimaryEmails: Map<string, string> = new Map();

    for (const userId of body.user_ids) {
      const user = userMap.get(userId);
      if (!user) {
        userSendErrors.set(userId, "User not found");
        continue;
      }
      const primaryEmail = user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value;
      if (!primaryEmail) {
        userSendErrors.set(userId, "User does not have a primary email");
        continue;
      }
      userPrimaryEmails.set(userId, primaryEmail);

      let currentNotificationCategory = defaultNotificationCategory;
      if (body.template_id) {
        // We have to render email twice in this case, first pass is to get the notification category
        const renderedTemplateFirstPass = await renderEmailWithTemplate(
          templateSource,
          themeSource,
          {
            user: { displayName: user.displayName },
            project: { displayName: auth.tenancy.project.display_name },
            variables: body.variables,
          },
        );
        if (renderedTemplateFirstPass.status === "error") {
          userSendErrors.set(userId, "There was an error rendering the email");
          continue;
        }
        const notificationCategory = getNotificationCategoryByName(renderedTemplateFirstPass.data.notificationCategory ?? "");
        if (!notificationCategory) {
          userSendErrors.set(userId, "Notification category not found with given name");
          continue;
        }
        currentNotificationCategory = notificationCategory;
      }

      const isNotificationEnabled = await hasNotificationEnabled(auth.tenancy, user.projectUserId, currentNotificationCategory.id);
      if (!isNotificationEnabled) {
        userSendErrors.set(userId, "User has disabled notifications for this category");
        continue;
      }

      let unsubscribeLink: string | undefined = undefined;
      if (currentNotificationCategory.can_disable) {
        const { code } = await unsubscribeLinkVerificationCodeHandler.createCode({
          tenancy: auth.tenancy,
          method: {},
          data: {
            user_id: user.projectUserId,
            notification_category_id: currentNotificationCategory.id,
          },
          callbackUrl: undefined
        });
        const unsubUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
        unsubUrl.pathname = "/api/v1/emails/unsubscribe-link";
        unsubUrl.searchParams.set("code", code);
        unsubscribeLink = unsubUrl.toString();
      }

      const renderedEmail = await renderEmailWithTemplate(
        templateSource,
        themeSource,
        {
          user: { displayName: user.displayName },
          project: { displayName: auth.tenancy.project.display_name },
          variables: body.variables,
          unsubscribeLink,
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
          subject: body.subject ?? renderedEmail.data.subject ?? "",
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
    }));

    return {
      statusCode: 200,
      bodyType: 'json',
      body: { results },
    };
  },
});
