import { TracedFreestyleSandboxes } from '@/lib/freestyle';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { bundleJavaScript } from '@stackframe/stack-shared/dist/utils/esbuild';

export function createTemplateComponentFromHtml(
  html: string,
  unsubscribeLink?: string,
) {
  const unsubscribeLinkHtml = unsubscribeLink ? `<br /><br /><a href="${unsubscribeLink}">Click here to unsubscribe</a>` : "";
  return deindent`
    export function EmailTemplate() {
      return <>
        <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)}}} />
        ${unsubscribeLinkHtml}
      </>
    };
  `;
}

export async function renderEmailWithTemplate(
  templateComponent: string,
  themeComponent: string,
  variables: Record<string, string> = {},
): Promise<Result<{ html: string, text: string, schema: any, subject?: string, notificationCategory?: string }, string>> {
  const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
  if (["development", "test"].includes(getNodeEnvironment()) && apiKey === "mock_stack_freestyle_key") {
    return Result.ok({
      html: `<div>Mock api key detected, \n\ntemplateComponent: ${templateComponent}\n\nthemeComponent: ${themeComponent}\n\n variables: ${JSON.stringify(variables)}</div>`,
      text: `<div>Mock api key detected, \n\ntemplateComponent: ${templateComponent}\n\nthemeComponent: ${themeComponent}\n\n variables: ${JSON.stringify(variables)}</div>`,
      schema: {},
      subject: "mock subject",
      notificationCategory: "mock notification category",
    });
  }
  const variablesAsProps = Object.entries(variables).map(([key, value]) => `${key}={${JSON.stringify(value)}}`).join(" ");
  const result = await bundleJavaScript({
    "/utils.tsx": findComponentValueUtil,
    "/theme.tsx": themeComponent,
    "/template.tsx": templateComponent,
    "/render.tsx": deindent`
      import React from 'react';
      import * as TemplateModule from "./template.tsx";
      const { schema, EmailTemplate } = TemplateModule;
      import { findComponentValue } from "./utils.tsx";
      import { EmailTheme } from "./theme.tsx";
      import { render } from '@react-email/components';

      export const renderAll = async () => {
        const EmailTemplateWithProps  = <EmailTemplate ${variablesAsProps} />;
        const Email = <EmailTheme>{EmailTemplateWithProps}</EmailTheme>;
        return {
          html: await render(Email),
          text: await render(Email, { plainText: true }),
          schema: schema ? schema.toJsonSchema() : undefined,
          subject: findComponentValue(EmailTemplateWithProps, "Subject"),
          notificationCategory: findComponentValue(EmailTemplateWithProps, "NotificationCategory"),
        };
      }
    `,
    "/entry.js": deindent`
      import { renderAll } from "./render.tsx";
      export default renderAll;
    `,
  }, {
    keepAsImports: ['arktype', 'react', 'react/jsx-runtime', '@react-email/components'],
    externalPackages: { '@stackframe/emails': stackframeEmailsPackage },
    format: 'esm',
    sourcemap: false,
  });
  if (result.status === "error") {
    return Result.error(result.error);
  }

  const freestyle = new TracedFreestyleSandboxes({ apiKey });
  const nodeModules = {
    "@react-email/components": "0.1.1",
    "arktype": "2.1.20",
  };
  const output = await freestyle.executeScript(result.data, { nodeModules });
  if ("error" in output) {
    return Result.error(output.error as string);
  }
  return Result.ok(output.result as { html: string, text: string, schema: any, subject: string, notificationCategory: string });
}


const findComponentValueUtil = `import React from 'react';
export function findComponentValue(element, targetStackComponent) {
  const matches = [];

  function traverse(node) {
    if (!React.isValidElement(node)) return;

    const type = node.type;
    const isTarget =
      type &&
      typeof type === "function" &&
      "__stackComponent" in type &&
      type.__stackComponent === targetStackComponent;

    if (isTarget) {
      matches.push(node);
    }

    const children = node.props?.children;
    if (Array.isArray(children)) {
      children.forEach(traverse);
    } else if (children) {
      traverse(children);
    }
  }
  traverse(element.type(element.props || {}));
  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length !== 1) {
    throw new Error(
      \`Expected exactly one occurrence of component "\${targetStackComponent}", found \${matches.length}.\`
    );
  }

  const matched = matches[0];
  const value = matched.props?.value;

  if (typeof value !== "string") {
    throw new Error(
      \`The "value" prop of "\${targetStackComponent}" must be a string.\`
    );
  }

  return value;
}`;

const stackframeEmailsPackage = deindent`
  export const Subject = (props) => null;
  Subject.__stackComponent = "Subject";
  export const NotificationCategory = (props) => null;
  NotificationCategory.__stackComponent = "NotificationCategory";
`;
