import { Freestyle } from '@/lib/freestyle';
import { emptyEmailTheme } from '@stackframe/stack-shared/dist/helpers/emails';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { bundleJavaScript } from '@stackframe/stack-shared/dist/utils/esbuild';
import { get, has } from '@stackframe/stack-shared/dist/utils/objects';
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { Tenancy } from './tenancies';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';

export function getActiveEmailTheme(tenancy: Tenancy) {
  const themeList = tenancy.config.emails.themes;
  const currentActiveTheme = tenancy.config.emails.selectedThemeId;
  if (!(has(themeList, currentActiveTheme))) {
    throw new StackAssertionError("No active email theme found", {
      themeList,
      currentActiveTheme,
    });
  }
  return get(themeList, currentActiveTheme);
}

export function getEmailThemeForTemplate(tenancy: Tenancy, templateThemeId: string | null | false | undefined) {
  const themeList = tenancy.config.emails.themes;
  if (templateThemeId && has(themeList, templateThemeId)) {
    return get(themeList, templateThemeId).tsxSource;
  }
  if (templateThemeId === false) {
    return emptyEmailTheme;
  }
  return getActiveEmailTheme(tenancy).tsxSource;
}

export function createTemplateComponentFromHtml(html: string) {
  return deindent`
    export const variablesSchema = v => v;
    export function EmailTemplate() {
      return <>
        <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)}}} />
      </>
    };
  `;
}

export async function renderEmailWithTemplate(
  templateOrDraftComponent: string,
  themeComponent: string,
  options: {
    user?: { displayName: string | null },
    project?: { displayName: string },
    variables?: Record<string, any>,
    unsubscribeLink?: string,
    previewMode?: boolean,
  },
): Promise<Result<{ html: string, text: string, subject?: string, notificationCategory?: string }, string>> {
  const variables = options.variables ?? {};
  const previewMode = options.previewMode ?? false;
  const user = (previewMode && !options.user) ? { displayName: "John Doe" } : options.user;
  const project = (previewMode && !options.project) ? { displayName: "My Project" } : options.project;
  if (!user) {
    throw new StackAssertionError("User is required when not in preview mode", { user, project, variables });
  }
  if (!project) {
    throw new StackAssertionError("Project is required when not in preview mode", { user, project, variables });
  }

  const result = await bundleJavaScript({
    "/utils.tsx": findComponentValueUtil,
    "/theme.tsx": themeComponent,
    "/template.tsx": templateOrDraftComponent,
    "/render.tsx": deindent`
      import { configure } from "arktype/config"
      configure({ onUndeclaredKey: "delete" })
      import React from 'react';
      import { render } from '@react-email/components';
      import { type } from "arktype";
      import { findComponentValue } from "./utils.tsx";
      import * as TemplateModule from "./template.tsx";
      const { variablesSchema, EmailTemplate } = TemplateModule;
      import { EmailTheme } from "./theme.tsx";
      export const renderAll = async () => {
        const variables = variablesSchema ? variablesSchema({
          ${previewMode ? "...(EmailTemplate.PreviewVariables || {})," : ""}
          ...(${JSON.stringify(variables)}),
        }) : {};
        if (variables instanceof type.errors) {
          throw new Error(variables.summary)
        }
        const unsubscribeLink = ${previewMode ? "EmailTheme.PreviewProps?.unsubscribeLink" : JSON.stringify(options.unsubscribeLink)};
        const EmailTemplateWithProps  = <EmailTemplate variables={variables} user={${JSON.stringify(user)}} project={${JSON.stringify(project)}} />;
        const Email = <EmailTheme unsubscribeLink={unsubscribeLink}>
          {${previewMode ? "EmailTheme.PreviewProps?.children ?? " : ""} EmailTemplateWithProps}
        </EmailTheme>;
        return {
          html: await render(Email),
          text: await render(Email, { plainText: true }),
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

  const freestyle = new Freestyle();
  const nodeModules = {
    "react": "19.1.1",
    "@react-email/components": "0.1.1",
    "arktype": "2.1.20",
  };
  const output = await freestyle.executeScript(result.data, { nodeModules });
  if (output.status === "error") {
    return Result.error(`${output.error}`);
  }
  return Result.ok(output.data.result as { html: string, text: string, subject: string, notificationCategory: string });
}

export async function renderEmailsWithTemplateBatched(
  templateOrDraftComponent: string,
  themeComponent: string,
  inputs: Array<{
    user: { displayName: string | null },
    project: { displayName: string },
    variables?: Record<string, any>,
    unsubscribeLink?: string,
  }>,
): Promise<Result<Array<{ html: string, text: string, subject?: string, notificationCategory?: string }>, string>> {
  const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");

  const serializedInputs = JSON.stringify(inputs);

  const result = await bundleJavaScript({
    "/utils.tsx": findComponentValueUtil,
    "/theme.tsx": themeComponent,
    "/template.tsx": templateOrDraftComponent,
    "/render.tsx": deindent`
      import { configure } from "arktype/config"
      configure({ onUndeclaredKey: "delete" })
      import React from 'react';
      import { render } from '@react-email/components';
      import { type } from "arktype";
      import { findComponentValue } from "./utils.tsx";
      import * as TemplateModule from "./template.tsx";
      const { variablesSchema, EmailTemplate } = TemplateModule;
      import { EmailTheme } from "./theme.tsx";

      export const renderAll = async () => {
        const inputs = ${serializedInputs}
        const renderOne = async (input: any) => {
          const variables = variablesSchema ? variablesSchema({
            ...(input.variables || {}),
          }) : {};
          if (variables instanceof type.errors) {
            throw new Error(variables.summary)
          }
          const EmailTemplateWithProps  = <EmailTemplate variables={variables} user={input.user} project={input.project} />;
          const Email = <EmailTheme unsubscribeLink={input.unsubscribeLink}>
            { EmailTemplateWithProps }
          </EmailTheme>;
          return {
            html: await render(Email),
            text: await render(Email, { plainText: true }),
            subject: findComponentValue(EmailTemplateWithProps, "Subject"),
            notificationCategory: findComponentValue(EmailTemplateWithProps, "NotificationCategory"),
          };
        };

        return await Promise.all(inputs.map(renderOne));
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

  const freestyle = new Freestyle({ apiKey });
  const nodeModules = {
    "react": "19.1.1",
    "@react-email/components": "0.1.1",
    "arktype": "2.1.20",
  };
  const executeResult = await freestyle.executeScript(result.data, { nodeModules });
  if (executeResult.status === "error") {
    return Result.error(executeResult.error);
  }
  return Result.ok(executeResult.data.result as Array<{ html: string, text: string, subject?: string, notificationCategory?: string }>);
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
