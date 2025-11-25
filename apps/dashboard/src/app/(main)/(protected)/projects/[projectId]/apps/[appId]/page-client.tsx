'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getAppPath, type AppId } from "@/lib/apps-frontend";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { PageLayout } from "../../page-layout";

export default function AppDetailsPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();

  const handleEnable = async () => {
    await project.updateConfig({
      [`apps.installed.${appId}.enabled`]: true,
    });
    const appFrontend = ALL_APPS_FRONTEND[appId];
    if (!appFrontend) {
      throw new StackAssertionError(`App frontend not found for appId: ${appId}`, { appId });
    }
    const path = getAppPath(project.id, appFrontend);
    router.push(path);
  };

  return (
    <PageLayout fillWidth>
      <AppStoreEntry
        appId={appId}
        onEnable={async () => runAsynchronouslyWithAlert(handleEnable())}
      />
    </PageLayout>
  );
}
