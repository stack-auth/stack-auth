"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppEnableContent } from "@/components/app-enable-content";
import { type AppId } from "@/lib/apps";
import { ReactNode, useState } from "react";

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
  const config = project.useConfig();
  const [isEnabling, setIsEnabling] = useState(false);
  
  // Read enabled apps from project configuration
  const enabledApps = config.apps?.installed || {};
  const isAppEnabled = enabledApps[appId]?.enabled || false;
  
  // Debug logging
  console.log(`🔍 RequireAppEnabled Debug for ${appId}:`);
  console.log("- Full config:", config);
  console.log("- Apps config:", config.apps);
  console.log("- Apps config keys:", Object.keys(config.apps || {}));
  console.log("- Available apps:", config.apps?.availableApps);
  console.log("- Installed apps:", config.apps?.installed);
  console.log("- Enabled apps:", enabledApps);
  console.log("- Is app enabled:", isAppEnabled);
  console.log("- App specific config:", enabledApps[appId]);

  const handleEnableApp = async () => {
    setIsEnabling(true);
    try {
      // Always enable required apps first
      const configUpdate: Record<string, boolean> = {
        [`apps.installed.${appId}.enabled`]: true
      };
      
      // Enable authentication and emails if not already enabled
      if (!enabledApps['authentication']?.enabled) {
        configUpdate['apps.installed.authentication.enabled'] = true;
      }
      if (!enabledApps['emails']?.enabled) {
        configUpdate['apps.installed.emails.enabled'] = true;
      }
      
      await project.updateConfig(configUpdate);
    } catch (error) {
      console.error("Failed to enable app:", error);
      // TODO: Show user-friendly error message
    } finally {
      setIsEnabling(false);
    }
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
      isEnabling={isEnabling}
    />
  );
}
