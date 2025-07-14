import { getEmailTemplate } from "@/lib/emails";
import { EMAIL_TEMPLATES_METADATA, renderRawComponent } from "@stackframe/stack-emails/dist/utils";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import HtmlToJSX from "htmltojsx";

export const GET = async () => {
  const template = await getEmailTemplate("c65e209d-d756-479a-b8f3-4cb5d2edada6", "email_verification");
  const metadata = EMAIL_TEMPLATES_METADATA["email_verification"];
  const props = metadata.variables.map((variable) => variable.name);
  const variablesToReplace = props.reduce((acc, prop) => ({
    ...acc,
    [prop]: `__PROP_${prop}__`,
  }), {});
  const { html } = renderRawComponent(template!.content, variablesToReplace);
  const htmlWithoutDoctype = html.replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "");
  const converter = new HtmlToJSX({ createClass: false });
  const jsx = converter.convert(htmlWithoutDoctype);
  const jsxWithProps = props.reduce(
    (acc, prop) => acc.replaceAll(`"__PROP_${prop}__"`, `{${prop}}`).replaceAll(`__PROP_${prop}__`, `{${prop}}`),
    jsx
  );
  const reactComponent = deindent`
    export function EmailTemplate({ ${props.join(', ')} }) {
      return (
        ${jsxWithProps}
      );
    }
  `;

  return new Response(reactComponent, {
    headers: {
      "Content-Type": "text/plain",
    },
  });
};
