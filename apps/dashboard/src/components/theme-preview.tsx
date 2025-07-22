import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { KnownErrors } from "@stackframe/stack-shared";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { BrowserFrame, Spinner, Typography } from "@stackframe/stack-ui";
import { Component, ReactNode, Suspense } from "react";

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

class EmailPreviewErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    if (error instanceof KnownErrors.EmailRenderingError) {
      return { hasError: true };
    }
    throw error;
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center p-4">
          <Typography type="h3" className="mb-2" variant="destructive">
            Email Rendering Error
          </Typography>
          <Typography variant="secondary">
            Unable to render email preview. Please check your theme / template source code.
          </Typography>
        </div>
      );
    }
    return this.props.children;
  }
}

function ThemePreviewContent({
  themeId,
  renderedHtmlOverride,
  disableFrame,
  templateId,
}: {
  themeId: string,
  renderedHtmlOverride?: string,
  disableFrame?: boolean,
  templateId?: string,
}) {
  const stackAdminApp = useAdminApp();
  const previewHtml = stackAdminApp.useEmailPreview(themeId, templateId ? undefined : previewEmailHtml, templateId);

  const Content = (
    <iframe srcDoc={renderedHtmlOverride ?? previewHtml} className={`${disableFrame ? "pointer-events-none" : ""} h-full`} />
  );

  if (disableFrame) {
    return Content;
  }
  return (
    <BrowserFrame transparentBackground className="flex flex-col grow">
      {Content}
    </BrowserFrame>
  );
}

export default function ThemePreview({
  themeId,
  renderedHtmlOverride,
  disableFrame,
  templateId,
}: {
  themeId: string,
  renderedHtmlOverride?: string,
  disableFrame?: boolean,
  templateId?: string,
}) {
  return (
    <div className="w-fit mx-auto h-full flex flex-col justify-center">
      <Suspense fallback={<Spinner />}>
        <EmailPreviewErrorBoundary>
          <ThemePreviewContent
            themeId={themeId}
            renderedHtmlOverride={renderedHtmlOverride}
            disableFrame={disableFrame}
            templateId={templateId}
          />
        </EmailPreviewErrorBoundary>
      </Suspense>
    </div>
  );
}
