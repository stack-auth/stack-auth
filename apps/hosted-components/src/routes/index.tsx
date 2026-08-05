import { createFileRoute } from '@tanstack/react-router';
import { DevelopmentPageNote } from "~/components/development-page-note";
import { HostedAuthMessage } from "~/hosted-components/auth/supporting/layout";

export const Route = createFileRoute('/')({
  component: RootPage,
});

function RootPage() {
  return (
    <>
      <HostedAuthMessage
        title="No destination configured"
        primaryAction={() => window.history.back()}
        primaryText="Back"
        fullPage
      >
        This hosted root page does not have a destination. Go back to the website that opened it, or close this tab.
      </HostedAuthMessage>
      <DevelopmentPageNote description="The hosted root is a diagnostic fallback. Configure an explicit destination instead of navigating users here." />
    </>
  );
}
