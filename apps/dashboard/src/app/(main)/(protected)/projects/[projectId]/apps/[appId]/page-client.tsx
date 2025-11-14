'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { PageLayout } from "../../page-layout";

export default function AppDetailsPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  const handleEnable = async () => {
    await wait(1000);
    await project.updateConfig({
      [`apps.installed.${appId}.enabled`]: true,
    });
    const path = getAppPath(project.id, ALL_APPS_FRONTEND[appId]);
    router.push(path);
  };

  return (
    <PageLayout>
      <AppStoreEntry
        appId={appId}
        onEnable={handleEnable}
      />
    </PageLayout>
  );
}
