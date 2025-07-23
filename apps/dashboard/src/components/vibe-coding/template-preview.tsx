import { Reader } from "@stackframe/stack-emails/dist/editor/email-builder/index";
import {
  EMAIL_TEMPLATES_METADATA,
  convertEmailTemplateMetadataExampleValues,
  convertEmailTemplateVariables,
  validateEmailTemplateContent
} from "@stackframe/stack-emails/dist/utils";
import { BrowserFrame } from "@stackframe/stack-ui";
import { useMemo } from "react";

type TemplatePreviewProps = {
  template: {
    id: string,
    content: any,
    type: keyof typeof EMAIL_TEMPLATES_METADATA,
  },
  projectDisplayName: string,
  renderedHtmlOverride?: string,
}

export default function TemplatePreview({
  template,
  projectDisplayName,
  renderedHtmlOverride
}: TemplatePreviewProps) {
  const [valid, document] = useMemo(() => {
    const valid = validateEmailTemplateContent(template.content);
    if (!valid) return [false, null];

    const metadata = convertEmailTemplateMetadataExampleValues(
      EMAIL_TEMPLATES_METADATA[template.type],
      projectDisplayName
    );
    const document = convertEmailTemplateVariables(template.content, metadata.variables);
    return [true, document];
  }, [template.content, template.type, projectDisplayName]);

  if (renderedHtmlOverride) {
    return (
      <BrowserFrame transparentBackground className="flex flex-col grow">
        <iframe srcDoc={renderedHtmlOverride} className="pointer-events-none h-full" />
      </BrowserFrame>
    );
  }

  let reader;
  if (valid && document) {
    reader = (
      <div className="w-full h-full">
        <Reader document={document} rootBlockId='root' />
      </div>
    );
  } else {
    reader = <div className="flex items-center justify-center h-full text-red-500">Invalid template</div>;
  }

  return (
    <BrowserFrame transparentBackground className="flex flex-col grow">
      <div className="p-4 h-full overflow-auto">
        {reader}
      </div>
    </BrowserFrame>
  );
}
