import { openai } from "@ai-sdk/openai";
import { yupArray, yupNumber, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { convertToCoreMessages, generateText, tool } from "ai";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { z } from "zod";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { FreestyleSandboxes } from "freestyle-sandboxes";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Chat with the dev server",
    description: "Chat with the dev server to get help with email theme development",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
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
      text: yupString().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }

    const result = await generateText({
      model: openai("gpt-4o"),
      system: DEFAULT_SYSTEM_PROMPT,
      messages: convertToCoreMessages(body.messages),
      tools: {
        createEmailTheme: tool({
          description: CREATE_EMAIL_THEME_TOOL_DESCRIPTION,
          parameters: z.object({
            content: z.string().describe("The content of the email theme"),
          }),
          execute: async (args) => {
            const freestyle = new FreestyleSandboxes({ apiKey });
            const { fs } = await freestyle.requestDevServer({ repoId: body.repo_id });
            await fs.writeFile("src/email-theme.tsx", args.content);
            return { success: true };
          },
        }),
      }
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        text: result.text,
      },
    };
  },
});


const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can help with email theme development.`;

const CREATE_EMAIL_THEME_TOOL_DESCRIPTION = `
Create a new email theme.
The email theme is a React component that is used to render the email theme.
It must use react-email components.
It must be exported as a default export.
It must take one prop, children, which is a React node.
It must not import from any package besides "@react-email/components".

Here is an example of a valid email theme:
\`\`\`tsx
import { Container, Head, Html, Tailwind } from '@react-email/components'

export default function LightTheme({ children }: { children: React.ReactNode }) {
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
`;
