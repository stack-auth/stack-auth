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
    description: `Create a new email draft for Stack Auth.

**What is an Email Draft?**
An email draft is a simpler version of an email template, without variable schemas. It's used for one-off emails or quick email creation.

**Requirements:**
- Must use @react-email/components for email components
- Can import from @stackframe/emails for Stack Auth-specific utilities
- Must export ONE thing: \`EmailTemplate\` function component
- Must include Subject and NotificationCategory components
- Uses Tailwind classes for all styling
- Can access user and project data via Props

**Differences from Email Templates:**
- No variablesSchema required
- No custom variables (only user and project data)
- No PreviewVariables needed
- Simpler for one-off or standard emails

**Structure:**
1. Import required components
2. Define EmailTemplate function component using Props type
3. Include Subject (can use user data)
4. Include NotificationCategory
5. Add email content using react-email components

**Example Valid Email Draft:**
\`\`\`tsx
import { Container, Text, Button } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value={\`Welcome to \${project.displayName}, \${user.displayName}!\`} />
      <NotificationCategory value="Transactional" />
      
      <Text className="text-2xl font-bold">
        Welcome, {user.displayName}!
      </Text>
      
      <Text>
        Thank you for joining {project.displayName}. We're excited to have you here.
      </Text>
      
      <Text>
        Get started by visiting your dashboard and exploring the features.
      </Text>
      
      <Button href="https://example.com/dashboard" className="bg-blue-600 text-white px-4 py-2 rounded">
        Go to Dashboard
      </Button>
    </Container>
  );
}
\`\`\`

**Guidelines:**
- Keep content clear and focused
- Use appropriate tone
- Personalize with user and project data
- Include clear call-to-actions when needed
- Make it mobile-responsive
- Use email-safe styling

**Output:**
Return the COMPLETE draft code including all imports and component definition.`,
    inputSchema: z.object({
      content: z.string().describe("The complete email draft code as a TypeScript React component"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
