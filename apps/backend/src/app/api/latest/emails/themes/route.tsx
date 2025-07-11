import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { DEFAULT_EMAIL_THEMES } from "@/lib/email-themes";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";


export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create email theme",
    description: "Creates a new email theme",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      display_name: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  async handler({ body, auth: { tenancy } }) {
    const themeList = tenancy.completeConfig.emails.themeList;
    if (Object.values(themeList).some((theme) => theme.displayName === body.display_name)) {
      throw new KnownErrors.ThemeWithNameAlreadyExists(body.display_name);
    }
    const id = generateUuid();
    await overrideEnvironmentConfigOverride({
      tx: prismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        emails: {
          themeList: {
            ...themeList,
            [id]: {
              displayName: body.display_name,
              tsxSource: DEFAULT_EMAIL_THEMES["default-light"]
            },
          },
        },
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { id },
    };
  },
});

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get email themes",
    description: "Gets a list of email themes for a project",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      themes: yupArray(yupObject({
        id: yupString().uuid().defined(),
        display_name: yupString().defined(),
      })).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    const themes = Object.entries(tenancy.completeConfig.emails.themeList).map(([id, theme]) => ({
      id,
      display_name: theme.displayName,
    }));
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        themes,
      },
    };
  },
});
