'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { useUpdateConfig } from "@/lib/config-update";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

export default function AppDetailsModalPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const updateConfig = useUpdateConfig();

  const handleEnable = async () => {
    await wait(1000);
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: true },
      pushable: true,
    });
    const path = getAppPath(project.id, ALL_APPS_FRONTEND[appId]);
    router.push(path);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && router.back()} modal>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0 flex flex-col" noCloseButton>
        <AppStoreEntry
          appId={appId}
          onEnable={handleEnable}
          titleComponent={DialogTitle}
        />
      </DialogContent>
    </Dialog>
  );
}
