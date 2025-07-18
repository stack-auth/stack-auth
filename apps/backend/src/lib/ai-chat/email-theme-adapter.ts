import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { renderEmailWithTheme } from "@/lib/email-themes";
import { globalPrismaClient } from "@/prisma-client";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { tool } from "ai";
import { z } from "zod";
import { ChatAdapterContext } from "./adapter-registry";

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

export const emailThemeAdapter = (context: ChatAdapterContext) => ({
  systemPrompt: `You are a helpful assistant that can help with email theme development.`,

  tools: {
    createEmailTheme: tool({
      description: CREATE_EMAIL_THEME_TOOL_DESCRIPTION(context),
      parameters: z.object({
        content: z.string().describe("The content of the email theme"),
      }),
      execute: async (args) => {
        const result = await renderEmailWithTheme(previewEmailHtml, args.content);
        if ("error" in result) {
          return { success: false, error: result.error };
        }
        await overrideEnvironmentConfigOverride({
          tx: globalPrismaClient,
          projectId: context.tenancy.project.id,
          branchId: context.tenancy.branchId,
          environmentConfigOverrideOverride: {
            [`emails.themeList.${context.threadId}.tsxSource`]: args.content,
          },
        });
        return { success: true, html: result.html };
      },
    }),
  },
});

const CREATE_EMAIL_THEME_TOOL_DESCRIPTION = (context: ChatAdapterContext) => {
  const currentEmailTheme = context.tenancy.completeConfig.emails.themeList[context.threadId].tsxSource || "";

  return `
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
};
