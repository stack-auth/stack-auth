import { EmailVerification } from '@hexclave/react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/email-verification-demo')({
  component: EmailVerificationDemoPage,
});

function EmailVerificationDemoPage() {
  return <EmailVerification searchParams={{ code: "demo-email-verification-code" }} fullPage />;
}
