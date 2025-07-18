import { TracedFreestyleSandboxes } from '@/lib/freestyle';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";


export async function renderEmailWithTheme(
  htmlContent: string,
  themeComponent: string,
  unsubscribeLink?: string,
) {
  const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
  const unsubscribeLinkHtml = unsubscribeLink ? `<br /><br /><a href="${unsubscribeLink}">Click here to unsubscribe</a>` : "";
  if (["development", "test"].includes(getNodeEnvironment()) && apiKey === "mock_stack_freestyle_key") {
    return {
      html: `<div>Mock api key detected, themeComponent: ${themeComponent}, htmlContent: ${htmlContent}, ${unsubscribeLinkHtml}</div>`,
      text: "Mock api key detected, returning mock data",
    };
  }

  const freestyle = new TracedFreestyleSandboxes({ apiKey });
  const script = deindent`
    import React from 'react';
    import { render } from '@react-email/components';
    ${themeComponent}
    export default async () => {
      const Email = <EmailTheme>
        <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(htmlContent)}}} />
        ${unsubscribeLinkHtml}
      </EmailTheme>;
      return {
        html: await render(Email),
        text: await render(Email, { plainText: true }),
      };
    }
  `;
  const nodeModules = {
    "@react-email/components": "0.1.1",
  };
  const output = await freestyle.executeScript(script, { nodeModules });
  if ("error" in output) {
    return Result.error(output.error as string);
  }
  return output.result as { html: string, text: string };
}


const LightEmailTheme = `import { Html, Tailwind, Body } from '@react-email/components';
function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Tailwind>
        <Body>
          <div className="bg-white text-slate-800 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
            {children}
          </div>
        </Body>
      </Tailwind>
    </Html>
  );
}`;


const DarkEmailTheme = `import { Html, Tailwind, Body } from '@react-email/components';
function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Tailwind>
        <Body>
          <div className="bg-slate-900 text-slate-100 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
            {children}
          </div>
        </Body>
      </Tailwind>
    </Html>
  );
}`;


export const DEFAULT_EMAIL_THEMES = {
  'default-light': LightEmailTheme,
  'default-dark': DarkEmailTheme,
} as const;
