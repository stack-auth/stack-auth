'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getAppPath, type AppId } from "@/lib/apps-frontend";
import { PageLayout } from "../../page-layout";

export default function AppDetailsPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();

  const handleEnable = async () => {
    try {
      await project.updateConfig({
        [`apps.installed.${appId}.enabled`]: true,
      });
      const appFrontend = ALL_APPS_FRONTEND[appId];
      if (!appFrontend) {
        throw new Error(`App frontend not found for appId: ${appId}`);
      }
      const path = getAppPath(project.id, appFrontend);
      router.push(path);
    } catch (error) {
      console.error("Failed to enable app:", error);
      alert("Failed to enable app. Please try again.");
    }
  };

  return (
    <PageLayout fillWidth>
      <AppStoreEntry
        appId={appId}
        onEnable={handleEnable}
      />
    </PageLayout>
  );
}
