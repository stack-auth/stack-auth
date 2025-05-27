import { PageLayout } from "../page-layout";
import { DeleteAccountSection } from "./delete-account-section";
import { SignOutSection } from "./sign-out-section";


export function SettingsPage(props?: {
  mockMode?: boolean
}) {
  return (
    <PageLayout>
      <DeleteAccountSection />
      <SignOutSection />
    </PageLayout>
  );
}
