import { Tenancy } from '@/lib/tenancies';
import { EMAIL_TEMPLATES_METADATA } from '@stackframe/stack-emails/dist/utils';
import { DEFAULT_TEMPLATE_IDS } from '@stackframe/stack-shared/dist/helpers/emails';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { TracedFreestyleSandboxes } from '@/lib/freestyle';

export function getNewEmailTemplate(tenancy: Tenancy, type: keyof typeof EMAIL_TEMPLATES_METADATA) {
  const templateList = tenancy.completeConfig.emails.templateList;
  if (type === "email_verification") {
    return templateList[DEFAULT_TEMPLATE_IDS.email_verification];
  }
  if (type === "password_reset") {
    return templateList[DEFAULT_TEMPLATE_IDS.password_reset];
  }
  if (type === "magic_link") {
    return templateList[DEFAULT_TEMPLATE_IDS.magic_link];
  }
  if (type === "team_invitation") {
    return templateList[DEFAULT_TEMPLATE_IDS.team_invitation];
  }
  return templateList[DEFAULT_TEMPLATE_IDS.sign_in_invitation];
}

export async function renderEmailWithTemplate(
  templateComponent: string,
  themeComponent: string,
  variables: Record<string, string>,
) {
  const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
  if (["development", "test"].includes(getNodeEnvironment()) && apiKey === "mock_stack_freestyle_key") {
    return Result.ok({
      html: `<div>Mock api key detected, \n\ntemplateComponent: ${templateComponent}\n\nthemeComponent: ${themeComponent}\n\n variables: ${JSON.stringify(variables)}</div>`,
      text: `<div>Mock api key detected, \n\ntemplateComponent: ${templateComponent}\n\nthemeComponent: ${themeComponent}\n\n variables: ${JSON.stringify(variables)}</div>`,
    });
  }
  const freestyle = new TracedFreestyleSandboxes({ apiKey });
  const variablesAsProps = Object.entries(variables).map(([key, value]) => `${key}={${JSON.stringify(value)}}`).join(" ");
  const script = deindent`
    import React from 'react';
    import { render } from '@react-email/components';
    ${themeComponent}
    ${templateComponent}
    export default async () => {
      const Email = <EmailTheme>
        <EmailTemplate ${variablesAsProps} />
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
  return Result.ok(output.result as { html: string, text: string });
}
