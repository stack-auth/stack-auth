import { EmailVerification } from '@hexclave/react';
import { createFileRoute } from '@tanstack/react-router';
import { DevelopmentPageNote } from "~/components/development-page-note";

export const Route = createFileRoute('/email-verification-demo')({
  component: EmailVerificationDemoPage,
});

function EmailVerificationDemoPage() {
  return (
    <>
      <EmailVerification searchParams={{ code: "demo-email-verification-code" }} fullPage />
      <DevelopmentPageNote
        pageKey="emailVerification"
        description="This is a demo of Hexclave's default email-verification page. Use the prompt below to customize your own page."
      />
    </>
  );
}
