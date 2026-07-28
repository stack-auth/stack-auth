import { EmailVerification } from '@hexclave/react';
import { createFileRoute } from '@tanstack/react-router';
import { DevelopmentPageNote } from "~/components/development-page-note";

export const Route = createFileRoute('/email-verification-demo')({
  component: EmailVerificationDemoPage,
});

function EmailVerificationDemoPage() {
  return (
    <>
      <div data-hexclave-handler-page className="min-h-screen w-full">
        <EmailVerification searchParams={{ code: "demo-email-verification-code" }} fullPage />
      </div>
      <DevelopmentPageNote
        pageKey="emailVerification"
        description="This is a demo of Hexclave's default email-verification page. Use the prompt below to customize your own page."
      />
    </>
  );
}
