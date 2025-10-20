import { SiteLoadingIndicator } from "@/components/site-loading-indicator";
import { UrlPrefetcher } from "@/lib/prefetch/url-prefetcher";
import { Suspense } from "react";
import SidebarLayout from "./sidebar-layout";
import { AdminAppProvider } from "./use-admin-app";

export default async function Layout(
  props: { children: React.ReactNode, modal?: React.ReactNode, params: Promise<{ projectId: string }> }
) {
  return (
    <Suspense fallback={<SiteLoadingIndicator />}>
      <AdminAppProvider projectId={(await props.params).projectId}>

        {/* Pre-fetch the current URL to prevent request waterfalls */}
        <UrlPrefetcher href="" />

        <SidebarLayout projectId={(await props.params).projectId}>
          {props.children}
          {props.modal}
        </SidebarLayout>
      </AdminAppProvider>
    </Suspense>
  );
}
