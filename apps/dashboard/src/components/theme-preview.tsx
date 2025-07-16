import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { BrowserFrame } from "@stackframe/stack-ui";

export const previewEmailHtml = deindent`
  <div>
    <h2 className="mb-4 text-2xl font-bold">
      Header text
    </h2>
    <p className="mb-4">
      Body text content with some additional information.
    </p>
  </div>
`;

export default function ThemePreview({
  themeId,
  renderedHtmlOverride,
  disableFrame,
}: {
  themeId: string,
  renderedHtmlOverride?: string,
  disableFrame?: boolean,
}) {
  const stackAdminApp = useAdminApp();
  const previewHtml = stackAdminApp.useEmailThemePreview(themeId, previewEmailHtml);

  return (
    <div className="w-fit mx-auto h-full flex flex-col">
      {disableFrame ? (
        <iframe srcDoc={renderedHtmlOverride ?? previewHtml} className="mx-auto pointer-events-none h-full" />
      ) : (
        <BrowserFrame transparentBackground className="flex flex-col grow">
          <iframe srcDoc={renderedHtmlOverride ?? previewHtml} className="mx-auto pointer-events-none h-full" />
        </BrowserFrame>
      )}
    </div>
  );
}
