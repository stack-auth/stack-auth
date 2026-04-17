import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

/**
 * Creates a tool for generating email template code.
 *
 * This tool does NOT execute server-side - it returns the tool call to the caller,
 * who is responsible for processing the generated template code.
 *
 * @param auth - Optional auth context (can be used to fetch current template if needed)
 */
export function createEmailTemplateTool(auth: SmartRequestAuth | null) {
  return tool({
    description: `
Create a new email template.
The email template is a tsx file that is used to render the email content.
It must use react-email components.
It must export two things:
- variablesSchema: An arktype schema for the email template props
- EmailTemplate: A function that renders the email template. You must set the PreviewVariables property to an object that satisfies the variablesSchema by doing EmailTemplate.PreviewVariables = { ...
It must not import from any package besides "@react-email/components", "@stackframe/emails", and "arktype".
It uses tailwind classes for all styling.
The user's current email template will be provided in the conversation messages.
The email must include <Html>, <Head />, <Preview />, <Tailwind>, <Body>, and <Container> in the correct hierarchy.
Do not use any Tailwind classes that require style injection (e.g., hover:, focus:, active:, group-hover:, media queries, dark:, etc.). Only use inlineable Tailwind utilities.
The <Head /> component must be rendered inside <Tailwind> to support Tailwind style injection

Here is an example of a valid email template:
\`\`\`tsx
import { type } from "arktype"
import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export const variablesSchema = type({
  count: "number"
});

export function EmailTemplate({ user, variables }: Props<typeof variablesSchema.infer>) {
  return (
    <Container>
      <Subject value={\`Hello \${user.displayName}!\`} />
      <NotificationCategory value="Transactional" />
      <div className="font-bold">Hi {user.displayName}!</div>
      <br />
      count is {variables.count}
    </Container>
  );
}

EmailTemplate.PreviewVariables = {
  count: 10
} satisfies typeof variablesSchema.infer
\`\`\`

The user's current email template can be found in the conversation messages.
`,
    inputSchema: z.object({
      content: z.string().describe("A react component that renders the email template"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
