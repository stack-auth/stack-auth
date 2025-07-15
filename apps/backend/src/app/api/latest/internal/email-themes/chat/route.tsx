import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { renderEmailWithTheme } from "@/lib/email-themes";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { openai } from "@ai-sdk/openai";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { convertToCoreMessages, generateText, tool } from "ai";
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
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema,
    }),
    body: yupObject({
      theme_id: yupString().defined(),
      current_email_theme: yupString().defined(),
      messages: yupArray(yupObject({
        role: yupString().oneOf(["user", "assistant"]).defined(),
        content: yupString().defined(),
      })).defined().min(1),
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
    const themeList = tenancy.completeConfig.emails.themeList;
    if (!Object.keys(themeList).includes(body.theme_id)) {
      throw new StatusError(400, "No theme found with given id");
    }
    const theme = themeList[body.theme_id];
    const result = await generateText({
      model: openai("gpt-4o"),
      system: DEFAULT_SYSTEM_PROMPT,
      messages: convertToCoreMessages(body.messages),
      tools: {
        createEmailTheme: tool({
          description: CREATE_EMAIL_THEME_TOOL_DESCRIPTION(body.current_email_theme),
          parameters: z.object({
            content: z.string().describe("The content of the email theme"),
          }),
          execute: async (args) => {
            const result = await renderEmailWithTheme("<div>test</div>", args.content);
            if ("error" in result) {
              return { success: false, error: result.error };
            }
            await overrideEnvironmentConfigOverride({
              tx: globalPrismaClient,
              projectId: tenancy.project.id,
              branchId: tenancy.branchId,
              environmentConfigOverrideOverride: {
                emails: {
                  themeList: {
                    ...themeList,
                    [body.theme_id]: {
                      tsxSource: args.content,
                      displayName: theme.displayName,
                    },
                  },
                },
              },
            });
            return { success: true, html: result.html };
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

    const userContent = [{ "type": "text", "text": body.messages.at(-1)?.content }];
    await globalPrismaClient.threadMessage.createMany({
      data: [
        { tenancyId: tenancy.id, threadId: body.theme_id, role: "user", content: userContent },
        { tenancyId: tenancy.id, threadId: body.theme_id, role: "assistant", content: contentBlocks },
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
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      theme_id: yupString().defined(),
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
    const dbMessages = await globalPrismaClient.threadMessage.findMany({
      where: { tenancyId: tenancy.id, threadId: query.theme_id },
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
