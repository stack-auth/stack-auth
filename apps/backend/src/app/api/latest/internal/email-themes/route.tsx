import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { LightEmailTheme } from "@stackframe/stack-shared/dist/helpers/emails";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { filterUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
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
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.themes.${id}`]: {
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
    const themeList = tenancy.config.emails.themes;
    const currentActiveTheme = tenancy.config.emails.selectedThemeId;

    const themes = typedEntries(themeList).map(([id, theme]) => filterUndefined({
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
