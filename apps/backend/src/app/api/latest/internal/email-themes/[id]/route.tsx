import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient } from "@/prisma-client";
import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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
      tsx_source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      display_name: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id }, body }) {
    const themeList = tenancy.completeConfig.emails.themeList;
    if (!Object.keys(themeList).includes(id)) {
      throw new StatusError(404, "No theme found with given id");
    }
    const theme = themeList[id];
    const result = await renderEmailWithTemplate(previewTemplateSource, body.tsx_source);
    if (result.status === "error") {
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.themeList.${id}.tsxSource`]: body.tsx_source,
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        display_name: theme.displayName,
      },
    };
  },
});
