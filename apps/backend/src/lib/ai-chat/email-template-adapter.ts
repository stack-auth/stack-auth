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
  const currentEmailTemplate = context.tenancy.completeConfig.emails.templates[context.threadId];

  return `
Create a new email template.
The email template is a tsx file that is used to render the email content.
It must use react-email components.
It must export two things:
- variablesSchema: An arktype schema for the email template props
- EmailTemplate: A function that renders the email template. You must set the PreviewVariables property to an object that satisfies the variablesSchema by doing EmailTemplate.PreviewVariables = { ...
It must not import from any package besides "@react-email/components", "@stackframe/emails", and "arktype".
It uses tailwind classes for all styling.

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

Here is the user's current email template:
\`\`\`tsx
${currentEmailTemplate.tsxSource}
\`\`\`
`;
};
