import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { BrowserFrame, Spinner } from "@stackframe/stack-ui";
import { Suspense } from "react";

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

function ThemePreviewContent({
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
    <>
      {disableFrame ? (
        <iframe srcDoc={renderedHtmlOverride ?? previewHtml} className="pointer-events-none h-full" />
      ) : (
        <BrowserFrame transparentBackground className="flex flex-col grow">
          <iframe srcDoc={renderedHtmlOverride ?? previewHtml} className="pointer-events-none h-full" />
        </BrowserFrame>
      )}
    </>
  );
}

export default function ThemePreview({
  themeId,
  renderedHtmlOverride,
  disableFrame,
}: {
  themeId: string,
  renderedHtmlOverride?: string,
  disableFrame?: boolean,
}) {
  return (
    <div className="w-fit mx-auto h-full flex flex-col justify-center">
      <Suspense fallback={<Spinner />}>
        <ThemePreviewContent
          themeId={themeId}
          renderedHtmlOverride={renderedHtmlOverride}
          disableFrame={disableFrame}
        />
      </Suspense>
    </div>
  );
}
