import SidebarLayout from "./sidebar-layout";
import { AdminAppProvider } from "./use-admin-app";

export default async function Layout(
  props: { children: React.ReactNode, params: Promise<{ projectId: string }> }
) {
  return (
    <AdminAppProvider projectId={(await props.params).projectId}>
      <SidebarLayout projectId={(await props.params).projectId}>
        {props.children}
      </SidebarLayout>
    </AdminAppProvider>
  );
}
