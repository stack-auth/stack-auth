import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

/**
 * Creates a tool for generating email theme code.
 *
 * This tool does NOT execute server-side - it returns the tool call to the caller,
 * who is responsible for processing the generated theme code.
 *
 * @param auth - Optional auth context (can be used to fetch current theme if needed)
 */
export function createEmailThemeTool(auth: SmartRequestAuth | null) {
  return tool({
    description: `
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

The user's current email theme can be found in the conversation messages.
`,
    inputSchema: z.object({
      content: z.string().describe("The content of the email theme"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
