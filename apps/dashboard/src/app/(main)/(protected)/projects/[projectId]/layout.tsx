import { UrlPrefetcher } from "@/lib/prefetch/url-prefetcher";
import SidebarLayout from "./sidebar-layout";
import { AdminAppProvider } from "./use-admin-app";
export { generateStaticParams } from "@/lib/generate-empty-static-params";

export default function Layout(
  props: { children: React.ReactNode, modal?: React.ReactNode }
) {
  return (
    <AdminAppProvider>

      {/* Pre-fetch the current URL to prevent request waterfalls */}
      <UrlPrefetcher href="" />

      <SidebarLayout>
        {props.children}
        {props.modal}
      </SidebarLayout>
    </AdminAppProvider>
  );
}
