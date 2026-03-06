import { templateThemeIdToThemeMode, themeModeToTemplateThemeId } from "@/lib/email-drafts";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, templateThemeIdSchema, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: yupObject({}).defined(),
    }).defined(),
    params: yupObject({ id: yupString().uuid().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().uuid().defined(),
      display_name: yupString().defined(),
      tsx_source: yupString().defined(),
      theme_id: templateThemeIdSchema,
      sent_at_millis: yupNumber().nullable().optional(),
      template_variables: yupRecord(yupString(), jsonSchema.defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const d = await prisma.emailDraft.findFirst({ where: { tenancyId: tenancy.id, id: params.id } });
    if (!d) {
      throw new StatusError(StatusError.NotFound, "No draft found with given id");
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: d.id,
        display_name: d.displayName,
        tsx_source: d.tsxSource,
        theme_id: themeModeToTemplateThemeId(d.themeMode, d.themeId),
        sent_at_millis: d.sentAt ? d.sentAt.getTime() : null,
        template_variables: (d.templateVariables as Record<string, string> | null) ?? {},
      },
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: yupObject({}).defined(),
    }).defined(),
    params: yupObject({ id: yupString().uuid().defined() }).defined(),
    body: yupObject({
      display_name: yupString().optional(),
      theme_id: templateThemeIdSchema.optional(),
      tsx_source: yupString().optional(),
      template_variables: yupRecord(yupString(), jsonSchema.defined()).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ ok: yupString().oneOf(["ok"]).defined() }).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    await prisma.emailDraft.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: params.id } },
      data: {
        displayName: body.display_name,
        themeMode: templateThemeIdToThemeMode(body.theme_id),
        themeId: body.theme_id === false ? null : body.theme_id,
        tsxSource: body.tsx_source,
        ...(body.template_variables !== undefined ? { templateVariables: body.template_variables } : {}),
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { ok: "ok" },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: yupObject({}).defined(),
    }).defined(),
    params: yupObject({ id: yupString().uuid().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ ok: yupString().oneOf(["ok"]).defined() }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const existing = await prisma.emailDraft.findFirst({ where: { tenancyId: tenancy.id, id: params.id } });
    if (!existing) {
      throw new StatusError(StatusError.NotFound, "No draft found with given id");
    }
    await prisma.emailDraft.delete({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: params.id } },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { ok: "ok" },
    };
  },
});

