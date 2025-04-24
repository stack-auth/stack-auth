import { Suspense } from "react";
import { OnboardingDialog } from "./onboarding-dialog";
import SidebarLayout from "./sidebar-layout";
import { AdminAppProvider } from "./use-admin-app";

export default async function Layout(
  props: { children: React.ReactNode, params: Promise<{ projectId: string }> }
) {
  return (
    (<AdminAppProvider projectId={(await props.params).projectId}>
      {/* Don't block the rest of the page for the dialog, so wrap it with a Suspense */}
      <Suspense fallback={<></>}>
        <OnboardingDialog />
      </Suspense>
      <SidebarLayout projectId={(await props.params).projectId}>
        {props.children}
      </SidebarLayout>
    </AdminAppProvider>)
  );
}
