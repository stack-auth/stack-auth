
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================
import { PageLayout } from "../page-layout";
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
    </PageLayout>
  );
}
