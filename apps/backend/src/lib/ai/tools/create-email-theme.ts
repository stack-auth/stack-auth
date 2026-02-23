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

The email theme is a React component that wraps all emails with a consistent layout.

EXACT PROP SIGNATURE (do not change or add props):
\`\`\`tsx
type EmailThemeProps = {
  children: React.ReactNode,    // required — the email body
  unsubscribeLink?: string,     // optional URL string — use as href={unsubscribeLink}, NOT as a function call
}
\`\`\`

Other requirements:
- Must include \`<Html>\`, \`<Head>\`, and a \`<Tailwind>\` wrapper (the theme owns the full document)
- Import ONLY from \`@react-email/components\` — no other packages
- Use standard Tailwind utility classes in \`className\` props — do NOT pass a \`config\` prop to \`<Tailwind>\`
- EVERY component used in JSX must be explicitly imported
- JavaScript object literals use COMMAS between properties, never semicolons

The user's current email theme can be found in the conversation messages.

Here is an example of a valid email theme:
\`\`\`tsx
import { Body, Container, Head, Hr, Html, Link, Section, Text, Tailwind } from '@react-email/components'

export function EmailTheme({ children, unsubscribeLink }: { children: React.ReactNode, unsubscribeLink?: string }) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-gray-50 font-sans">
          <Container className="mx-auto max-w-[600px] py-8 px-4">
            <Section className="bg-white rounded-lg shadow-sm p-8">
              {children}
            </Section>
            <Section className="mt-6 text-center">
              <Hr className="border-gray-200 mb-4" />
              {unsubscribeLink && (
                <Text className="text-xs text-gray-400">
                  <Link href={unsubscribeLink} className="text-gray-400 underline">Unsubscribe</Link>
                </Text>
              )}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
\`\`\`
`,
    inputSchema: z.object({
      content: z.string().describe("The content of the email theme"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
