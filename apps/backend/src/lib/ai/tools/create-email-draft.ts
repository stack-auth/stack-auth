import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

/**
 * Creates a tool for generating email draft code.
 *
 * Email drafts are simpler than templates - they don't have variable schemas
 * and are meant for one-off or custom emails.
 *
 * This tool does NOT execute server-side - it returns the tool call to the caller.
 *
 * @param auth - Optional auth context
 */
export function createEmailDraftTool(auth: SmartRequestAuth | null) {
  return tool({
    description: `
Create a new email draft.
The email draft is a tsx file that is used to render the email content.
It must use react-email components.
It must export one thing:
- EmailTemplate: A function that renders the email draft
It must not import from any package besides "@react-email/components", "@stackframe/emails", and "arktype".
It uses tailwind classes for all styling.
The email must include <Html>, <Head />, <Preview />, <Tailwind>, <Body>, and <Container> in the correct hierarchy.
Do not use any Tailwind classes that require style injection (e.g., hover:, focus:, active:, group-hover:, media queries, dark:, etc.). Only use inlineable Tailwind utilities.
The <Head /> component must be rendered inside <Tailwind> to support Tailwind style injection
Here is an example of a valid email draft:
\`\`\`tsx
import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value={\`Hello \${user.displayName}!\`} />
      <NotificationCategory value="Transactional" />
      <div className="font-bold">Hi {user.displayName}!</div>
      <br />
    </Container>
  );
}
\`\`\`

The user's current email draft can be found in the conversation messages.
`,
    inputSchema: z.object({
      content: z.string().describe("A react component that renders the email template"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
