import { getEmailDraft, themeModeToTemplateThemeId } from "@/lib/email-drafts";
import { createTemplateComponentFromHtml, getEmailThemeForTemplate, renderEmailsWithTemplateBatched } from "@/lib/email-rendering";
import { getEmailConfig, sendEmail, sendEmailResendBatched } from "@/lib/emails";
import { getNotificationCategoryByName, hasNotificationEnabled } from "@/lib/notification-categories";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, templateThemeIdSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getChunks } from "@stackframe/stack-shared/dist/utils/arrays";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { unsubscribeLinkVerificationCodeHandler } from "../unsubscribe-link/verification-handler";

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
    const userPrimaryEmails: Map<string, string> = new Map();
    for (const user of userMap.values()) {
      const primaryEmail = user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value;
      if (primaryEmail) {
        userPrimaryEmails.set(user.projectUserId, primaryEmail);
      }
    }

    const results: UserResult[] = Array.from(userMap.values()).map((user) => ({
      user_id: user.projectUserId,
      user_email: userPrimaryEmails.get(user.projectUserId) ?? user.contactChannels.find((c) => c.isPrimary === "TRUE")?.value,
    }));

    const BATCH_SIZE = 100;

    const resolveCategoriesForUsers = async (usersWithPrimary: typeof users) => {
      const currentCategories = new Map<string, ReturnType<typeof getNotificationCategoryByName>>();
      if (!("html" in body)) {
        const firstPassInputs = usersWithPrimary.map((user) => ({
          user: { displayName: user.displayName },
          project: { displayName: auth.tenancy.project.display_name },
          variables,
        }));

        const chunks = getChunks(firstPassInputs, BATCH_SIZE);
        const userChunks = getChunks(usersWithPrimary, BATCH_SIZE);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const correspondingUsers = userChunks[i];
          const rendered = await renderEmailsWithTemplateBatched(templateSource, themeSource, chunk);
          if (rendered.status === "error") {
            continue;
          }
          const outputs = rendered.data;
          for (let j = 0; j < outputs.length; j++) {
            const output = outputs[j];
            const user = correspondingUsers[j];
            const category = getNotificationCategoryByName(output.notificationCategory ?? "");
            currentCategories.set(user.projectUserId, category);
          }
        }
      } else {
        for (const user of usersWithPrimary) {
          currentCategories.set(user.projectUserId, defaultNotificationCategory);
        }
      }
      return currentCategories;
    };

    const getAllowedUsersWithUnsub = async (usersWithPrimary: typeof users, currentCategories: Map<string, ReturnType<typeof getNotificationCategoryByName>>) => {
      const allowed = await Promise.all(usersWithPrimary.map(async (user) => {
        const category = currentCategories.get(user.projectUserId) ?? defaultNotificationCategory;
        const enabled = await hasNotificationEnabled(auth.tenancy, user.projectUserId, category.id);
        return enabled ? { user, category } : null;
      })).then(r => r.filter((x): x is { user: typeof users[number], category: NonNullable<ReturnType<typeof getNotificationCategoryByName>> } => Boolean(x)));

      const unsubLinks = new Map<string, string | undefined>();
      await Promise.all(allowed.map(async ({ user, category }) => {
        if (!category.can_disable) {
          unsubLinks.set(user.projectUserId, undefined);
          return;
        }
        const { code } = await unsubscribeLinkVerificationCodeHandler.createCode({
          tenancy: auth.tenancy,
          method: {},
          data: {
            user_id: user.projectUserId,
            notification_category_id: category.id,
          },
          callbackUrl: undefined
        });
        const unsubUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
        unsubUrl.pathname = "/api/v1/emails/unsubscribe-link";
        unsubUrl.searchParams.set("code", code);
        unsubLinks.set(user.projectUserId, unsubUrl.toString());
      }));
      return { allowed, unsubLinks };
    };

    const renderAndSendBatches = async (finalUsers: typeof users, unsubLinks: Map<string, string | undefined>) => {
      const finalInputs = finalUsers.map((user) => ({
        user: { displayName: user.displayName },
        project: { displayName: auth.tenancy.project.display_name },
        variables,
        unsubscribeLink: unsubLinks.get(user.projectUserId),
      }));

      const inputChunks = getChunks(finalInputs, BATCH_SIZE);
      const userChunks = getChunks(finalUsers, BATCH_SIZE);

      for (let i = 0; i < inputChunks.length; i++) {
        const chunk = inputChunks[i];
        const correspondingUsers = userChunks[i];
        const rendered = await renderEmailsWithTemplateBatched(templateSource, themeSource, chunk);
        if (rendered.status === "error") {
          continue;
        }
        const outputs = rendered.data;
        const emailOptions = outputs.map((output, idx) => {
          const user = correspondingUsers[idx];
          const email = userPrimaryEmails.get(user.projectUserId);
          if (!email) return null;
          return {
            tenancyId: auth.tenancy.id,
            emailConfig,
            to: email,
            subject: body.subject ?? output.subject ?? "",
            html: output.html,
            text: output.text,
          };
        }).filter((option): option is NonNullable<typeof option> => Boolean(option));

        if (emailConfig.host === "smtp.resend.com") {
          await sendEmailResendBatched(emailConfig.password, emailOptions);
        } else {
          await Promise.allSettled(emailOptions.map(option => sendEmail(option)));
        }
      }
    };

    runAsynchronouslyAndWaitUntil((async () => {
      const usersArray = Array.from(userMap.values());

      const usersWithPrimary = usersArray.filter(u => userPrimaryEmails.has(u.projectUserId));
      const currentCategories = await resolveCategoriesForUsers(usersWithPrimary);
      const { allowed, unsubLinks } = await getAllowedUsersWithUnsub(usersWithPrimary, currentCategories);
      const finalUsers = allowed.map(({ user }) => user);
      await renderAndSendBatches(finalUsers, unsubLinks);

      if ("draft_id" in body) {
        await prisma.emailDraft.update({
          where: {
            tenancyId_id: {
              tenancyId: auth.tenancy.id,
              id: body.draft_id,
            },
          },
          data: { sentAt: new Date() },
        });
      }
    })());

    if ("draft_id" in body) {
      await prisma.emailDraft.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: body.draft_id,
          },
        },
        data: { sentAt: new Date() },
      });
    }

    return {
      statusCode: 200,
      bodyType: 'json',
      body: { results },
    };
  },
});
