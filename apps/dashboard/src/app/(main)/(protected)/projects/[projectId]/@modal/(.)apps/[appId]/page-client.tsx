'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppStoreEntry } from "@/components/app-store-entry";
import { useRouter } from "@/components/router";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { useUpdateConfig } from "@/lib/config-update";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function AppDetailsModalPageClient({ appId }: { appId: AppId }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(true);
  const [navigateTo, setNavigateTo] = useState<string | null>(null);
  const hasNavigatedRef = useRef(false);

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;

  useEffect(() => {
    const isModalRoute = /\/apps\/[^/]+$/.test(pathname);
    if (isModalRoute) {
      setIsOpen(true);
      setNavigateTo(null);
      hasNavigatedRef.current = true;
    }
  }, [pathname]);

  useEffect(() => {
    if (!isOpen && navigateTo && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      router.replace(navigateTo);
    }
  }, [isOpen, navigateTo, router]);

  const handleEnable = async () => {
    await updateConfig({
      adminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: true },
      pushable: true,
    });
  };

  const handleOpen = () => {
    const path = getAppPath(project.id, ALL_APPS_FRONTEND[appId]);
    hasNavigatedRef.current = false;
    setNavigateTo(path);
    setIsOpen(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsOpen(false);
      if (!navigateTo) {
        router.replace(`/projects/${project.id}/apps`);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange} modal>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0 flex flex-col" noCloseButton>
        <AppStoreEntry
          appId={appId}
          isEnabled={isEnabled}
          onEnable={handleEnable}
          onOpen={handleOpen}
          titleComponent={DialogTitle}
        />
      </DialogContent>
    </Dialog>
  );
}
