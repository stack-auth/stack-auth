import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { renderEmailWithTemplate } from "@/lib/email-themes";
import { globalPrismaClient } from "@/prisma-client";
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
      execute: async (args) => {
        const theme = context.tenancy.completeConfig.emails.themeList[context.tenancy.completeConfig.emails.theme];
        const result = await renderEmailWithTemplate(theme.tsxSource, args.content, { projectDisplayName: context.tenancy.project.display_name });
        if ("error" in result) {
          return { success: false, error: result.error };
        }
        await overrideEnvironmentConfigOverride({
          tx: globalPrismaClient,
          projectId: context.tenancy.project.id,
          branchId: context.tenancy.branchId,
          environmentConfigOverrideOverride: {
            [`emails.templateList.${context.threadId}.tsxSource`]: args.content,
          },
        });
        return { success: true, html: result.html };
      },
    }),
  },
});


const CREATE_EMAIL_TEMPLATE_TOOL_DESCRIPTION = (context: ChatAdapterContext) => {
  const currentEmailTemplate = context.tenancy.completeConfig.emails.templateList[context.threadId];

  return `
Create a new email template.
The email template is a React component that is used to render the email content.
It must use react-email components.
It must be exported as a function with name "EmailTemplate".
It should use the following props: {${currentEmailTemplate.variables.join(", ")}}
It must not import from any package besides "@react-email/components".
It uses tailwind classes for all styling.

Here is an example of a valid email template:
\`\`\`tsx
export function EmailTemplate({ projectDisplayName }) {
  return <div className="font-bold">Email Verification  for { projectDisplayName }</div>; 
}
\`\`\`

Here is the user's current email template:
\`\`\`tsx
${currentEmailTemplate.tsxSource}
\`\`\`
`;
};
