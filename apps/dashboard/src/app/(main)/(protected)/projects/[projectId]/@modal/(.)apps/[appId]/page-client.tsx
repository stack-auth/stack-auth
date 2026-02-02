'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { useUpdateConfig } from "@/lib/config-update";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function AppDetailsModalPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(true);

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;

  // Control modal visibility based on whether we're on a modal route.
  // This ensures the modal only closes when navigation actually succeeds,
  // preventing issues if router.replace is vetoed by a confirmation dialog.
  useEffect(() => {
    const isModalRoute = /^\/projects\/[^/]+\/apps\/[^/]+$/.test(pathname);
    setIsOpen(isModalRoute);
  }, [pathname]);

  const handleEnable = async () => {
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: true },
      pushable: true,
    });
  };

  const handleDisable = async () => {
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: false },
      pushable: true,
    });
  };

  const handleOpen = () => {
    const path = getAppPath(project.id, ALL_APPS_FRONTEND[appId]);
    // Navigate to the app page. Modal stays open until pathname changes.
    router.replace(path);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Navigate back to apps list. Modal stays open until pathname changes.
      router.replace(`/projects/${project.id}/apps`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange} modal>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0 flex flex-col" noCloseButton>
        <AppStoreEntry
          appId={appId}
          isEnabled={isEnabled}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onOpen={handleOpen}
          titleComponent={DialogTitle}
        />
      </DialogContent>
    </Dialog>
  );
}
