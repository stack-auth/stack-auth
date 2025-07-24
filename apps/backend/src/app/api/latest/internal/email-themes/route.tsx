import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { LightEmailTheme } from "@stackframe/stack-shared/dist/helpers/emails";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEFAULT_EMAIL_THEME_ID } from "@stackframe/stack-shared/dist/helpers/emails";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";


export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
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
    const id = generateUuid();
    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.themeList.${id}`]: {
          displayName: body.display_name,
          tsxSource: LightEmailTheme,
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
    hidden: true,
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
    const themeList = tenancy.completeConfig.emails.themeList;
    const currentActiveTheme = tenancy.completeConfig.emails.theme;
    if (!(currentActiveTheme in themeList)) {
      let newActiveTheme: string;
      if (DEFAULT_EMAIL_THEME_ID in themeList) {
        newActiveTheme = DEFAULT_EMAIL_THEME_ID;
      } else {
        newActiveTheme = Object.keys(themeList)[0];
      }
      await overrideEnvironmentConfigOverride({
        tx: globalPrismaClient,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        environmentConfigOverrideOverride: {
          "emails.theme": newActiveTheme,
        },
      });
    }

    const themes = Object.entries(themeList).map(([id, theme]) => ({
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
