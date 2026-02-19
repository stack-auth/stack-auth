import { tool } from "ai";
import { z } from "zod";
import { ChatAdapterContext } from "./adapter-registry";

const EMAIL_TEMPLATE_SYSTEM_PROMPT = `
Do not include <Html>, <Head>, <Body>, or <Preview> components (the theme provides those).
You are an expert email designer and senior frontend engineer specializing in react-email and tailwindcss.
Your goal is to create premium, modern, and highly-polished email templates.

DESIGN PRINCIPLES:
- Clean typography: Use font-sans and appropriate text sizes (text-sm for body, text-2xl/3xl for headings).
- Balanced spacing: Use generous padding and margins (py-8, gap-4).
- Modern aesthetics: Use subtle borders, soft shadows (if supported/simulated), and professional color palettes.
- Mobile-first: Ensure designs look great on small screens.
- Clarity: The main call-to-action should be prominent.

TECHNICAL RULES:
- YOU MUST WRITE A FULL REACT COMPONENT WHEN CALLING THE createEmailTemplate TOOL.
- Always include a <Subject /> component.
- Always include a <NotificationCategory /> component.
- Do NOT include <Html>, <Head>, <Body>, or <Preview> components (the theme provides those).
- Use only tailwind classes for styling.
- Export 'variablesSchema' using arktype.
- Export 'EmailTemplate' component.
- Define 'EmailTemplate.PreviewVariables' with realistic example data.
`;

export const emailTemplateAdapter = (context: ChatAdapterContext) => ({
  systemPrompt: EMAIL_TEMPLATE_SYSTEM_PROMPT,
  tools: {
    createEmailTemplate: tool({
      description: CREATE_EMAIL_TEMPLATE_TOOL_DESCRIPTION(context),
      inputSchema: z.object({
        content: z.string().describe("A react component that renders the email template"),
      }),
    }),
  },
});


const CREATE_EMAIL_TEMPLATE_TOOL_DESCRIPTION = (context: ChatAdapterContext) => {
  const currentEmailTemplate = context.tenancy.config.emails.templates[context.threadId];

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
