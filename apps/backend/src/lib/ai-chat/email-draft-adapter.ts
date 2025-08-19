import { tool } from "ai";
import { z } from "zod";
import { ChatAdapterContext } from "./adapter-registry";

const EMAIL_DRAFT_SYSTEM_PROMPT = `
You are a helpful assistant that can help with email template development.
YOU MUST WRITE A FULL REACT COMPONENT WHEN CALLING THE createEmailTemplate TOOL.
`;

export const emailDraftAdapter = (context: ChatAdapterContext) => ({
  systemPrompt: EMAIL_DRAFT_SYSTEM_PROMPT,
  tools: {
    createEmailTemplate: tool({
      description: CREATE_EMAIL_DRAFT_TOOL_DESCRIPTION(),
      parameters: z.object({
        content: z.string().describe("A react component that renders the email template"),
      }),
    }),
  },
});


const CREATE_EMAIL_DRAFT_TOOL_DESCRIPTION = () => {
  return `
Create a new email draft.
The email draft is a tsx file that is used to render the email content.
It must use react-email components.
It must export one thing:
- EmailTemplate: A function that renders the email draft
It must not import from any package besides "@react-email/components", "@stackframe/emails", and "arktype".
It uses tailwind classes for all styling.

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
`;
};
