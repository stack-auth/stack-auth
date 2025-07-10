import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { FreestyleSandboxes } from 'freestyle-sandboxes';

function getFilePath(file: string): string {
  switch (file) {
    case "theme": {
      return "src/email-theme.tsx";
    }
    default: {
      throw new StatusError(400, `Unsupported file: ${file}`);
    }
  }
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get file content from dev server",
    description: "Retrieves the content of a file from the email theme dev server",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
    }).nullable(),
    query: yupObject({
      file: yupString().oneOf(["theme"]).defined(),
      repo_id: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      content: yupString().defined(),
    }).defined(),
  }),
  async handler({ query }) {
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }

    if (apiKey === "mock_stack_freestyle_key") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          content: "// Mock theme content\nexport default function EmailTheme() {\n  return <div>Hello World</div>;\n}",
        },
      };
    }

    const freestyle = new FreestyleSandboxes({ apiKey });
    const { fs } = await freestyle.requestDevServer({ repoId: query.repo_id });

    const filePath = getFilePath(query.file);
    const content = await fs.readFile(filePath);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        content,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Edit file content on dev server",
    description: "Updates the content of a file on the email theme dev server",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
    }).nullable(),
    body: yupObject({
      file: yupString().oneOf(["theme"]).defined(),
      repo_id: yupString().defined(),
      content: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }

    if (apiKey === "mock_stack_freestyle_key") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: true,
        },
      };
    }

    const freestyle = new FreestyleSandboxes({ apiKey });
    const { fs } = await freestyle.requestDevServer({ repoId: body.repo_id });

    const filePath = getFilePath(body.file);
    await fs.writeFile(filePath, body.content);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
