import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, templateThemeIdSchema, yupArray, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { templateThemeIdToThemeMode, themeModeToTemplateThemeId } from "@/lib/email-drafts";


export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: yupObject({}).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      drafts: yupArray(yupObject({
        id: yupString().uuid().defined(),
        display_name: yupString().defined(),
        tsx_source: yupString().defined(),
        theme_id: templateThemeIdSchema,
        sent_at_millis: yupNumber().nullable().optional(),
        template_variables: yupRecord(yupString(), jsonSchema.defined()).defined(),
      })).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const items = await prisma.emailDraft.findMany({
      where: { tenancyId: tenancy.id },
      orderBy: { updatedAt: "desc" },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        drafts: items.map(d => ({
          id: d.id,
          display_name: d.displayName,
          tsx_source: d.tsxSource,
          theme_id: themeModeToTemplateThemeId(d.themeMode, d.themeId),
          sent_at_millis: d.sentAt ? d.sentAt.getTime() : null,
          template_variables: (d.templateVariables as Record<string, string> | null) ?? {},
        })),
      },
    };
  },
});


const defaultDraftSource = deindent`
  import { Container } from "@react-email/components";
  import { Subject, NotificationCategory, Props } from "@stackframe/emails";

  export function EmailTemplate({ user, project }: Props) {
    return (
      <Container>
        <Subject value={\`Hello \${user.displayName}!\`} />
        <NotificationCategory value="Marketing" />
        <div className="font-bold">Hi {user.displayName}!</div>
        <br />
      </Container>
    );
  }
`;

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: yupObject({}).defined(),
    }).defined(),
    body: yupObject({
      display_name: yupString().defined(),
      theme_id: templateThemeIdSchema,
      tsx_source: yupString().optional(),
      template_variables: yupRecord(yupString(), jsonSchema.defined()).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ id: yupString().uuid().defined() }).defined(),
  }),
  async handler({ body, auth: { tenancy } }) {
    const prisma = await getPrismaClientForTenancy(tenancy);

    const draft = await prisma.emailDraft.create({
      data: {
        tenancyId: tenancy.id,
        displayName: body.display_name,
        themeMode: templateThemeIdToThemeMode(body.theme_id),
        themeId: body.theme_id === false ? undefined : body.theme_id,
        tsxSource: body.tsx_source ?? defaultDraftSource,
        templateVariables: body.template_variables ?? {},
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: draft.id },
    };
  },
});

