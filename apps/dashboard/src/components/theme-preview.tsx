import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { KnownErrors } from "@stackframe/stack-shared";
import { BrowserFrame, Spinner, Typography } from "@stackframe/stack-ui";
import { Component, ReactNode, Suspense } from "react";
import { useDebounce } from 'use-debounce';


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
  themeTsxSource,
  templateId,
  templateTsxSource,
  disableFrame,
}: {
  themeId?: string,
  themeTsxSource?: string,
  templateId?: string,
  templateTsxSource?: string,
  disableFrame?: boolean,
}) {
  const stackAdminApp = useAdminApp();
  const previewHtml = stackAdminApp.useEmailPreview({
    themeId,
    themeTsxSource,
    templateId,
    templateTsxSource
  });

  const Content = (
    <iframe
      srcDoc={previewHtml}
      className={`${disableFrame ? "pointer-events-none" : ""} h-full`}
    />
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

type ThemePreviewProps =
  | ({
      themeId: string,
      themeTsxSource?: undefined,
    } | {
      themeId?: undefined,
      themeTsxSource: string,
    })
  & (
    | {
        templateId: string,
        templateTsxSource?: undefined,
      }
    | {
        templateId?: undefined,
        templateTsxSource: string,
      }
  ) & {
    disableFrame?: boolean,
  };

export default function ThemePreview({
  themeId,
  themeTsxSource,
  templateId,
  templateTsxSource,
  disableFrame,
}: ThemePreviewProps) {
  const [debouncedTemplateTsxSource] = useDebounce(templateTsxSource, 500);
  const [debouncedThemeTsxSource] = useDebounce(themeTsxSource, 500);

  return (
    <div className="w-fit mx-auto h-full flex flex-col justify-center">
      <Suspense fallback={<Spinner />}>
        <EmailPreviewErrorBoundary key={`${debouncedTemplateTsxSource ?? ""}${debouncedThemeTsxSource ?? ""}`}>
          <ThemePreviewContent
            themeId={themeId}
            themeTsxSource={debouncedThemeTsxSource}
            templateId={templateId}
            templateTsxSource={debouncedTemplateTsxSource}
            disableFrame={disableFrame}
          />
        </EmailPreviewErrorBoundary>
      </Suspense>
    </div>
  );
}
