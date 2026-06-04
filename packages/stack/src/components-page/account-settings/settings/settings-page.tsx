
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================
import { PageLayout } from "../page-layout";
import { DeleteAccountSection } from "./delete-account-section";
import { SignOutSection } from "./sign-out-section";


export function SettingsPage(props?: {
  mockMode?: boolean,
}) {
  return (
    <PageLayout>
      <DeleteAccountSection mockMode={props?.mockMode} />
      <SignOutSection mockMode={props?.mockMode} />
    </PageLayout>
  );
}
