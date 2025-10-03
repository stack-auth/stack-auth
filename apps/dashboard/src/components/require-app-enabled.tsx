"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppEnableContent } from "@/components/app-enable-content";
import { type AppId } from "@/lib/apps";
import { ReactNode } from "react";

interface RequireAppEnabledProps {
  appId: AppId;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequireAppEnabled({ 
  appId, 
  children, 
  fallback 
}: RequireAppEnabledProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  
  // For now, assume no apps are enabled since the config schema might not be updated yet
  // TODO: Update this when the config schema is properly deployed
  const enabledApps: Record<string, { enabled: boolean }> = {};
  const isAppEnabled = enabledApps[appId]?.enabled || false;

  const handleEnableApp = async () => {
    // TODO: Implement app enabling logic
    console.log("Enabling app:", appId);
    // This would typically update the project configuration
    // For now, just log the action
  };

  // If app is enabled, render children
  if (isAppEnabled) {
    return <>{children}</>;
  }

  // If custom fallback is provided, use it
  if (fallback) {
    return <>{fallback}</>;
  }

  // Default fallback: show app enable content
  return (
    <AppEnableContent
      appId={appId}
      projectId={stackAdminApp.projectId}
      onEnable={handleEnableApp}
      isEnabled={isAppEnabled}
    />
  );
}
