import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient } from "@/prisma-client";
import { renderEmailWithTheme } from "@/lib/email-themes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      display_name: yupString().defined(),
      tsx_source: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id } }) {
    const themeList = tenancy.completeConfig.emails.themeList;
    if (!Object.keys(themeList).includes(id)) {
      throw new StatusError(404, "No theme found with given id");
    }
    const theme = themeList[id];
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        display_name: theme.displayName,
        tsx_source: theme.tsxSource,
      },
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      id: yupString().defined(),
    }).defined(),
    body: yupObject({
      preview_html: yupString().defined(),
      tsx_source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      display_name: yupString().defined(),
      rendered_html: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id }, body }) {
    const themeList = tenancy.completeConfig.emails.themeList;
    if (!Object.keys(themeList).includes(id)) {
      throw new StatusError(404, "No theme found with given id");
    }
    const theme = themeList[id];
    const result = await renderEmailWithTheme(body.preview_html, body.tsx_source);
    if ("error" in result) {
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        emails: {
          themeList: {
            ...themeList,
            [id]: {
              tsxSource: body.tsx_source,
              displayName: theme.displayName,
            },
          },
        },
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        display_name: theme.displayName,
        rendered_html: result.html,
      },
    };
  },
});
