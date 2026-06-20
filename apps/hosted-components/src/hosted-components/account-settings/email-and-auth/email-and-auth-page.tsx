import { PageLayout } from "../page-layout";
import { ConnectedAccountsSection } from "./connected-accounts-section";
import { EmailsSection } from "./emails-section";
import { MfaSection } from "./mfa-section";
import { OtpSection } from "./otp-section";
import { PasskeySection } from "./passkey-section";
import { PasswordSection } from "./password-section";

export function EmailsAndAuthPage(props?: {
  mockMode?: boolean,
}) {
  return (
    <PageLayout>
      <EmailsSection mockMode={props?.mockMode}/>
      <PasswordSection mockMode={props?.mockMode} />
      <PasskeySection mockMode={props?.mockMode} />
      <OtpSection mockMode={props?.mockMode} />
      <MfaSection mockMode={props?.mockMode} />
      <ConnectedAccountsSection mockMode={props?.mockMode} />
    </PageLayout>
  );
}
