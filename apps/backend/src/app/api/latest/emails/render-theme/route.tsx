import { renderEmailWithTheme } from "@/lib/email-themes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { EMAIL_THEMES } from "@stackframe/stack-emails/dist/themes/index";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

const previewEmailHtml = deindent`
  <div>
    <h2 className="mb-4 text-2xl font-bold">
      Header text
    </h2>
    <p className="mb-4">
      Body text content with some additional information.
    </p>
  </div>
`;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Render email theme",
    description: "Renders HTML content using the specified email theme",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["client", "server", "admin"]).defined(),
    }).nullable(),
    query: yupObject({
      theme: yupString().oneOf(Object.keys(EMAIL_THEMES) as (keyof typeof EMAIL_THEMES)[]).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      html: yupString().defined(),
    }).defined(),
  }),
  async handler({ query }) {
    const { theme } = query;
    if (!getEnvVariable("FREESTYLE_API_KEY")) {
      throw new StatusError(500, "FREESTYLE_API_KEY is not set");
    }
    const result = await renderEmailWithTheme(previewEmailHtml, theme);
    if ("error" in result) {
      throw new StatusError(500, "Failed to render email theme");
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        html: result.html,
      },
    };
  },
});
