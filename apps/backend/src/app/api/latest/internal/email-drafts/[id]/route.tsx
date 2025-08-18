import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { templateThemeIdSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { templateThemeIdToThemeMode, themeModeToTemplateThemeId } from "@/lib/email-drafts";

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
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const d = await prisma.emailDraft.findFirstOrThrow({ where: { tenancyId: tenancy.id, id: params.id } });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: d.id,
        display_name: d.displayName,
        tsx_source: d.tsxSource,
        theme_id: themeModeToTemplateThemeId(d.themeMode, d.themeId),
        sent_at_millis: d.sentAt ? d.sentAt.getTime() : null,
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
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { ok: "ok" },
    };
  },
});

