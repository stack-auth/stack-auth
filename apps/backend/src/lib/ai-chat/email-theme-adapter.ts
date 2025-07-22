
import { tool } from "ai";
import { z } from "zod";
import { ChatAdapterContext } from "./adapter-registry";


export const emailThemeAdapter = (context: ChatAdapterContext) => ({
  systemPrompt: `You are a helpful assistant that can help with email theme development.`,

  tools: {
    createEmailTheme: tool({
      description: CREATE_EMAIL_THEME_TOOL_DESCRIPTION(context),
      parameters: z.object({
        content: z.string().describe("The content of the email theme"),
      }),
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
