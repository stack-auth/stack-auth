import { DeleteAccountSection } from "./delete-account-section";
import { PageLayout } from "./page-layout";
import { SignOutSection } from "./sign-out-section";


export function SettingsPage() {
  return (
    <PageLayout>
      <DeleteAccountSection />
      <SignOutSection />
    </PageLayout>
  );
}



