import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, templateThemeIdSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient } from "@/prisma-client";

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
      templates: yupArray(yupObject({
        id: yupString().uuid().defined(),
        display_name: yupString().defined(),
        tsx_source: yupString().defined(),
        theme_id: templateThemeIdSchema,
      })).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    const templates = Object.entries(tenancy.completeConfig.emails.templates).map(([id, template]) => ({
      id,
      display_name: template.displayName,
      tsx_source: template.tsxSource,
      theme_id: template.themeId,
    }));
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        templates,
      },
    };
  },
});

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
    const defaultTemplateSource = deindent`
      import { Container } from "@react-email/components";
      import { Subject, NotificationCategory, type } from "@stackframe/emails";
      export const schema = type({
        user: "StackUser"
      });
      export function EmailTemplate({ user }: typeof schema.infer) {
        return (
          <Container>
            <Subject value={\`Hello \${user.displayName}!\`} />
            <NotificationCategory value="Transactional" />
            <div className="font-bold">Hi {user.displayName}!</div>
          </Container>
        );
      }
    `;

    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.templates.${id}`]: {
          displayName: body.display_name,
          tsxSource: defaultTemplateSource,
          themeId: null,
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
