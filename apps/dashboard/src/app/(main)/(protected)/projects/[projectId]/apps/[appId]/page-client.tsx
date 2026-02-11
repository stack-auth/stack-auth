'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { useUpdateConfig } from "@/lib/config-update";
import { ALL_APPS_FRONTEND, getAppPath, type AppId } from "@/lib/apps-frontend";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { PageLayout } from "../../page-layout";

export default function AppDetailsPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;

  const appFrontend = ALL_APPS_FRONTEND[appId];
  if (!(appFrontend as any)) {
    throw new StackAssertionError(`App frontend not found for appId: ${appId}`, { appId });
  }
  const appPath = getAppPath(project.id, appFrontend);

  const handleEnable = async () => {
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: true },
      pushable: true,
    });
    router.push(appPath);
  };

  const handleOpen = () => {
    router.push(appPath);
  };

  const handleDisable = async () => {
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: false },
      pushable: true,
    });
  };

  return (
    <PageLayout fillWidth>
      <AppStoreEntry
        appId={appId}
        isEnabled={isEnabled}
        onEnable={async () => runAsynchronouslyWithAlert(handleEnable())}
        onOpen={handleOpen}
        onDisable={async () => runAsynchronouslyWithAlert(handleDisable())}
      />
    </PageLayout>
  );
}
