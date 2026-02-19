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
    description: `Create a new email theme for Stack Auth emails.

**What is an Email Theme?**
An email theme is a React component that wraps all email content, providing consistent structure, layout, and styling across all emails.

**Requirements:**
- Must use @react-email/components (no other imports allowed)
- Must be exported as a function named "EmailTheme"
- Must accept one prop: children (React.ReactNode)
- Must use Tailwind classes inside <Tailwind> tag
- Must include Html, Head, and appropriate container elements
- Should be responsive and compatible with major email clients

**Structure:**
1. Html wrapper
2. Head (for meta tags)
3. Tailwind wrapper (for styling)
4. Container/layout elements
5. {children} placeholder for email content

**Example Valid Email Theme:**
\`\`\`tsx
import { Container, Head, Html, Tailwind } from '@react-email/components'

export function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Container className="bg-white p-8 rounded-lg">
          {children}
        </Container>
      </Tailwind>
    </Html>
  )
}
\`\`\`

**Guidelines:**
- Keep it simple and focused on layout/structure
- Use neutral, professional styling that works for various email types
- Ensure good spacing and readability
- Make it mobile-responsive
- Test compatibility with email clients (use email-safe CSS)

**Output:**
Return the COMPLETE theme code as a TypeScript React component. Include all imports and the full component definition.`,
    inputSchema: z.object({
      content: z.string().describe("The complete email theme code as a TypeScript React component"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
