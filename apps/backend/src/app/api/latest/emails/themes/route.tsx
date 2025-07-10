import { DEFAULT_EMAIL_THEMES, renderEmailWithTheme } from "@/lib/email-themes";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { FreestyleSandboxes } from "freestyle-sandboxes";


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
      name: yupString().defined(),
      repo_id: yupString().defined(),
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
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }
    const freestyle = new FreestyleSandboxes({ apiKey });
    const { fs } = await freestyle.requestDevServer({ repoId: body.repo_id });
    const emailThemeComponent = await fs.readFile("src/email-theme.tsx");
    const result = await renderEmailWithTheme("<div>test</div>", emailThemeComponent);

    if ("error" in result) {
      captureError('render-email', new StackAssertionError("Error rendering email with theme", { result }));
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    const { id } = await prismaClient.emailTheme.create({
      data: {
        tenancyId: tenancy.id,
        name: body.name,
        component: emailThemeComponent,
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
      themes: yupArray(yupObject({ name: yupString().defined() })).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    const themes = await prismaClient.emailTheme.findMany({
      where: {
        tenancyId: tenancy.id,
      },
      select: {
        name: true,
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        themes: [
          ...themes,
          ...Object.keys(DEFAULT_EMAIL_THEMES).map((theme) => ({ name: theme })),
        ]
      },
    };
  },
});
