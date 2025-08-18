import { createTemplateComponentFromHtml, getEmailThemeForTemplate, renderEmailWithTemplate } from "@/lib/email-rendering";
import { getEmailConfig, sendEmail } from "@/lib/emails";
import { getNotificationCategoryByName, hasNotificationEnabled } from "@/lib/notification-categories";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, templateThemeIdSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { unsubscribeLinkVerificationCodeHandler } from "../unsubscribe-link/verification-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { getEmailDraft, themeModeToTemplateThemeId } from "@/lib/email-drafts";

type UserResult = {
  user_id: string,
  user_email?: string,
};

const bodyBase = yupObject({
  user_ids: yupArray(yupString().defined()).optional(),
  all_users: yupBoolean().oneOf([true]).optional(),
  subject: yupString().optional(),
  notification_category_name: yupString().optional(),
  theme_id: templateThemeIdSchema.nullable().meta({
    openapiField: { description: "The theme to use for the email. If not specified, the default theme will be used." }
  }),
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send email",
    description: "Send an email to a list of users. The content field should contain either {html} for HTML emails, {template_id, variables} for template-based emails, or {draft_id} for a draft email.",
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupUnion(
      bodyBase.concat(yupObject({
        html: yupString().defined(),
      })),
      bodyBase.concat(yupObject({
        template_id: yupString().uuid().defined(),
        variables: yupRecord(yupString(), yupMixed()).optional(),
      })),
      bodyBase.concat(yupObject({
        draft_id: yupString().defined(),
      })),
    ).defined(),
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
    if ((body.user_ids && body.all_users) || (!body.user_ids && !body.all_users)) {
      throw new KnownErrors.SchemaError("Exactly one of user_ids or all_users must be provided");
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const emailConfig = await getEmailConfig(auth.tenancy);
    const defaultNotificationCategory = getNotificationCategoryByName(body.notification_category_name ?? "Transactional") ?? throwErr(400, "Notification category not found with given name");
    let themeSource = getEmailThemeForTemplate(auth.tenancy, body.theme_id);
    const variables = "variables" in body ? body.variables : undefined;
    const templates = new Map(Object.entries(auth.tenancy.config.emails.templates));
    let templateSource: string;
    if ("template_id" in body) {
      templateSource = templates.get(body.template_id)?.tsxSource ?? throwErr(400, "No template found with given template_id");
    } else if ("html" in body) {
      templateSource = createTemplateComponentFromHtml(body.html);
    } else if ("draft_id" in body) {
      const draft = await getEmailDraft(prisma, auth.tenancy.id, body.draft_id) ?? throwErr(400, "No draft found with given draft_id");
      const theme_id = themeModeToTemplateThemeId(draft.themeMode, draft.themeId);
      templateSource = draft.tsxSource;
      if (body.theme_id === undefined) {
        themeSource = getEmailThemeForTemplate(auth.tenancy, theme_id);
      }
    } else {
      throw new KnownErrors.SchemaError("Either template_id, html, or draft_id must be provided");
    }

    const users = await prisma.projectUser.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: {
          in: body.user_ids
        },
      },
      include: {
        contactChannels: true,
      },
    });
    const missingUserIds = body.user_ids?.filter(userId => !users.some(user => user.projectUserId === userId));
    if (missingUserIds && missingUserIds.length > 0) {
      throw new KnownErrors.UserIdDoesNotExist(missingUserIds[0]);
    }
    const userMap = new Map(users.map(user => [user.projectUserId, user]));
    const userSendErrors: Map<string, string> = new Map();
    const userPrimaryEmails: Map<string, string> = new Map();

    for (const user of userMap.values()) {
      const primaryEmail = user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value;
      if (!primaryEmail) {
        userSendErrors.set(user.projectUserId, "User does not have a primary email");
        continue;
      }
      userPrimaryEmails.set(user.projectUserId, primaryEmail);

      let currentNotificationCategory = defaultNotificationCategory;
      if (!("html" in body)) {
        // We have to render email twice in this case, first pass is to get the notification category
        const renderedTemplateFirstPass = await renderEmailWithTemplate(
          templateSource,
          themeSource,
          {
            user: { displayName: user.displayName },
            project: { displayName: auth.tenancy.project.display_name },
            variables,
          },
        );
        if (renderedTemplateFirstPass.status === "error") {
          userSendErrors.set(user.projectUserId, "There was an error rendering the email");
          continue;
        }
        const notificationCategory = getNotificationCategoryByName(renderedTemplateFirstPass.data.notificationCategory ?? "");
        if (!notificationCategory) {
          userSendErrors.set(user.projectUserId, "Notification category not found with given name");
          continue;
        }
        currentNotificationCategory = notificationCategory;
      }

      const isNotificationEnabled = await hasNotificationEnabled(auth.tenancy, user.projectUserId, currentNotificationCategory.id);
      if (!isNotificationEnabled) {
        userSendErrors.set(user.projectUserId, "User has disabled notifications for this category");
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
          variables,
          unsubscribeLink,
        },
      );
      if (renderedEmail.status === "error") {
        userSendErrors.set(user.projectUserId, "There was an error rendering the email");
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
        userSendErrors.set(user.projectUserId, "Failed to send email");
      }
    }

    const results: UserResult[] = Array.from(userMap.values()).map((user) => ({
      user_id: user.projectUserId,
      user_email: userPrimaryEmails.get(user.projectUserId) ?? user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value,
    }));

    return {
      statusCode: 200,
      bodyType: 'json',
      body: { results },
    };
  },
});
