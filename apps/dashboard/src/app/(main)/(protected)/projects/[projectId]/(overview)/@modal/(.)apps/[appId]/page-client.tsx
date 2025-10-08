'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Dialog, DialogContent } from "@stackframe/stack-ui";

export default function AppDetailsModalPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();

  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  const handleEnable = async () => {
    await wait(1000);
    await project.updateConfig({
      [`apps.installed.${appId}.enabled`]: true,
    });
    router.back();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && router.back()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <AppStoreEntry
          appId={appId}
          onEnable={handleEnable}
        />
      </DialogContent>
    </Dialog>
  );
}
