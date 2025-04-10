import { EmailsSection } from "./emails-section";
import { MfaSection } from "./mfa-section";
import { OtpSection } from "./otp-section";
import { PageLayout } from "./page-layout";
import { PasskeySection } from "./passkey-section";
import { PasswordSection } from "./password-section";

export function EmailsAndAuthPage() {
  return (
    <PageLayout>
      <EmailsSection/>
      <PasswordSection />
      <PasskeySection />
      <OtpSection />
      <MfaSection />
    </PageLayout>
  );
}
