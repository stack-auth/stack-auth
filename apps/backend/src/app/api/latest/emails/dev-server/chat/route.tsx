import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { openai } from "@ai-sdk/openai";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { convertToCoreMessages, generateText, tool } from "ai";
import { FreestyleSandboxes } from "freestyle-sandboxes";
import { prismaClient } from "@/prisma-client";
import { InferType } from "yup";
import { z } from "zod";

const textContentSchema = yupObject({
  type: yupString().oneOf(["text"]).defined(),
  text: yupString().defined(),
});

const toolCallContentSchema = yupObject({
  type: yupString().oneOf(["tool-call"]).defined(),
  toolName: yupString().defined(),
  toolCallId: yupString().defined(),
  args: yupMixed().defined(),
  argsText: yupString().defined(),
  result: yupMixed().defined(),
});

const contentSchema = yupArray(yupUnion(textContentSchema, toolCallContentSchema)).defined();


export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Chat with the dev server",
    description: "Chat with the dev server to get help with email theme development",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema,
    }),
    body: yupObject({
      repo_id: yupString().defined(),
      messages: yupArray(yupObject({
        role: yupString().oneOf(["user", "assistant"]).defined(),
        content: yupString().defined(),
      })).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      content: contentSchema,
    }).defined(),
  }),
  async handler({ body, auth: { tenancy } }) {
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }
    const userContent = body.messages.at(-1);
    if (!userContent) {
      throw new StatusError(400, "No user content");
    }

    const freestyle = new FreestyleSandboxes({ apiKey });
    const { fs } = await freestyle.requestDevServer({ repoId: body.repo_id });
    const currentEmailTheme = await fs.readFile("src/email-theme.tsx");
    const result = await generateText({
      model: openai("gpt-4o"),
      system: DEFAULT_SYSTEM_PROMPT,
      messages: convertToCoreMessages(body.messages),
      tools: {
        createEmailTheme: tool({
          description: CREATE_EMAIL_THEME_TOOL_DESCRIPTION(currentEmailTheme),
          parameters: z.object({
            content: z.string().describe("The content of the email theme"),
          }),
          execute: async (args) => {
            const { fs } = await freestyle.requestDevServer({ repoId: body.repo_id });
            await fs.writeFile("src/email-theme.tsx", args.content);
            return { success: true };
          },
        }),
      }
    });

    const contentBlocks: InferType<typeof contentSchema> = [];
    result.steps.forEach((step) => {
      if (step.text) {
        contentBlocks.push({
          type: "text",
          text: step.text,
        });
      }
      step.toolResults.forEach((toolResult) => {
        contentBlocks.push({
          type: "tool-call",
          toolName: toolResult.toolName,
          toolCallId: toolResult.toolCallId,
          args: toolResult.args,
          argsText: JSON.stringify(toolResult.args),
          result: toolResult.result,
        });
      });
    });

    await prismaClient.threadMessage.createMany({
      data: [
        { tenancyId: tenancy.id, threadId: body.repo_id, role: "user", content: [{ "type": "text", "text": userContent.content }] },
        { tenancyId: tenancy.id, threadId: body.repo_id, role: "assistant", content: contentBlocks },
      ]
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { content: contentBlocks },
    };
  },
});

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get the thread messages",
    description: "Get the thread messages",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      repo_id: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      messages: yupArray(yupObject({
        role: yupString().oneOf(["user", "assistant", "tool"]).defined(),
        content: contentSchema,
      })),
    }),
  }),
  async handler({ query, auth: { tenancy } }) {
    const dbMessages = await prismaClient.threadMessage.findMany({
      where: { tenancyId: tenancy.id, threadId: query.repo_id },
      orderBy: { createdAt: "asc" },
    });
    const messages = dbMessages.map((message) => ({
      role: message.role,
      content: message.content as InferType<typeof contentSchema>,
    }));

    return {
      statusCode: 200,
      bodyType: "json",
      body: { messages },
    };
  },
});

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can help with email theme development.`;

const CREATE_EMAIL_THEME_TOOL_DESCRIPTION = (currentEmailTheme: string) => `
Create a new email theme.
The email theme is a React component that is used to render the email theme.
It must use react-email components.
It must be exported as a function with name "EmailTheme".
It must take one prop, children, which is a React node.
It must not import from any package besides "@react-email/components".
It uses tailwind classes inside of the <Tailwind> tag.

Here is an example of a valid email theme:
\`\`\`tsx
import { Container, Head, Html, Tailwind } from '@react-email/components'

export function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Container>{children}</Container>
      </Tailwind>
    </Html>
  )
}
\`\`\`

Here is the current email theme:
\`\`\`tsx
${currentEmailTheme}
\`\`\`
`;
