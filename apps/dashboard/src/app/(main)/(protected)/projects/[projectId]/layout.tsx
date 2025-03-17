import { Suspense } from "react";
import { OnboardingDialog } from "./onboarding-dialog";
import SidebarLayout from "./sidebar-layout";
import { AdminAppProvider } from "./use-admin-app";

export default function Layout(props: { children: React.ReactNode, params: { projectId: string } }) {
  return (
    <AdminAppProvider projectId={props.params.projectId}>
      {/* Don't block the rest of the page for the dialog, so wrap it with a Suspense */}
      <Suspense fallback={<></>}>
        <OnboardingDialog />
      </Suspense>
      <h1>Hello, world!</h1>
      <SidebarLayout projectId={props.params.projectId}>
        {props.children}
      </SidebarLayout>
    </AdminAppProvider>
  );
}
