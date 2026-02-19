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
    description: `Create a new email template for Stack Auth.

**What is an Email Template?**
An email template is a complete email with content, variables, and metadata. It defines the structure and content of a specific type of email (e.g., welcome email, password reset, notification).

**Requirements:**
- Must use @react-email/components for email components
- Can import from @stackframe/emails for Stack Auth-specific utilities
- Can import from arktype for schema validation
- Must export TWO things:
  1. \`variablesSchema\`: An arktype schema defining template variables
  2. \`EmailTemplate\`: A function component that renders the email
- EmailTemplate must set PreviewVariables property with sample data
- Must use Props<typeof variablesSchema.infer> as the component props type
- Must include Subject and NotificationCategory components
- Uses Tailwind classes for all styling

**Structure:**
1. Import required components and types
2. Define variablesSchema using arktype
3. Define EmailTemplate function component
4. Include Subject (dynamic or static)
5. Include NotificationCategory (e.g., "Transactional", "Marketing")
6. Add email content using react-email components
7. Set EmailTemplate.PreviewVariables

**Example Valid Email Template:**
\`\`\`tsx
import { type } from "arktype"
import { Container, Text, Button } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export const variablesSchema = type({
  actionUrl: "string",
  expiresInHours: "number"
});

export function EmailTemplate({ user, variables }: Props<typeof variablesSchema.infer>) {
  return (
    <Container>
      <Subject value={\`Action Required, \${user.displayName}!\`} />
      <NotificationCategory value="Transactional" />
      
      <Text className="text-lg font-bold">
        Hi {user.displayName}!
      </Text>
      
      <Text>
        Please complete your action within {variables.expiresInHours} hours.
      </Text>
      
      <Button href={variables.actionUrl} className="bg-blue-600 text-white px-4 py-2 rounded">
        Take Action
      </Button>
    </Container>
  );
}

EmailTemplate.PreviewVariables = {
  actionUrl: "https://example.com/action",
  expiresInHours: 24
} satisfies typeof variablesSchema.infer;
\`\`\`

**Guidelines:**
- Make content clear, concise, and actionable
- Use appropriate tone for the email type
- Include all necessary information
- Add clear call-to-action buttons when needed
- Use user data (user.displayName, user.primaryEmail, etc.) to personalize
- Make it mobile-responsive
- Use email-safe styling

**Output:**
Return the COMPLETE template code including all imports, schema, component, and PreviewVariables.`,
    inputSchema: z.object({
      content: z.string().describe("The complete email template code as a TypeScript React component with schema"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
