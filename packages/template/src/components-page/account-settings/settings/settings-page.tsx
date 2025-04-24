import { PageLayout } from "../page-layout";
import { DeleteAccountSection } from "./delete-account-section";
import { SignOutSection } from "./sign-out-section";


export function SettingsPage() {
  return (
    <PageLayout>
      <DeleteAccountSection />
      <SignOutSection />
    </PageLayout>
  );
}
