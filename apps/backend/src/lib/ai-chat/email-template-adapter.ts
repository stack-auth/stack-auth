import { tool } from "ai";
import { z } from "zod";
import { ChatAdapterContext } from "./adapter-registry";

const EMAIL_TEMPLATE_SYSTEM_PROMPT = `
You are a helpful assistant that can help with email template development.
YOU MUST WRITE A FULL REACT COMPONENT WHEN CALLING THE createEmailTemplate TOOL.
`;

export const emailTemplateAdapter = (context: ChatAdapterContext) => ({
  systemPrompt: EMAIL_TEMPLATE_SYSTEM_PROMPT,
  tools: {
    createEmailTemplate: tool({
      description: CREATE_EMAIL_TEMPLATE_TOOL_DESCRIPTION(context),
      parameters: z.object({
        content: z.string().describe("A react component that renders the email template"),
      }),
    }),
  },
});


const CREATE_EMAIL_TEMPLATE_TOOL_DESCRIPTION = (context: ChatAdapterContext) => {
  const currentEmailTemplate = context.tenancy.completeConfig.emails.templateList[context.threadId];

  return `
Create a new email template.
The email template is a tsx file that is used to render the email content.
It must use react-email components.
It must export two things:
- schema: An arktype schema for the email template props
- EmailTemplate: A function that renders the email template.
It should use the following props: {${currentEmailTemplate.variables.join(", ")}}
It must not import from any package besides "@react-email/components", "@stackframe/emails", and "arktype".
It uses tailwind classes for all styling.

Here is an example of a valid email template:
\`\`\`tsx
import { Container } from "@react-email/components";
import { Subject, NotificationCategory } from "@stackframe/emails";
import { type } from "arktype";

export const schema = type({
  projectDisplayName: "string",
});

export function EmailTemplate({ projectDisplayName }: typeof schema.infer) {
  return (
    <Container>
      <Subject value="Email Verification" />
      <NotificationCategory value="Transactional" />
      <div className="font-bold">Email Verification  for { projectDisplayName }</div>
    </Container>
  );
}
\`\`\`

Here is the user's current email template:
\`\`\`tsx
${currentEmailTemplate.tsxSource}
\`\`\`
`;
};
