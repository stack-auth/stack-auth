"use client";

import { getIntegrations, getRegularApps, type AppId } from "@/lib/apps";
import { useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { AppDetailDialog } from "./app-detail-dialog";
import { AppGrid } from "./app-grid";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  
  // Read enabled apps from project configuration
  const enabledApps = config.apps?.installed || {};
  
  // Separate apps into enabled and available
  const regularApps = getRegularApps();
  const integrations = getIntegrations();
  
  const enabledRegularApps = regularApps.filter(app => enabledApps[app.id]?.enabled);
  const availableRegularApps = regularApps.filter(app => !enabledApps[app.id]?.enabled);
  
  const enabledIntegrations = integrations.filter(app => enabledApps[app.id]?.enabled);
  const availableIntegrations = integrations.filter(app => !enabledApps[app.id]?.enabled);
  
  // State for app detail dialog
  const [selectedApp, setSelectedApp] = useState<AppId | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  
  const handleAppClick = (appId: string) => {
    setSelectedApp(appId as AppId);
    setIsDialogOpen(true);
  };
  
  const handleEnableApp = async (appId: AppId) => {
    console.log("🚀 Starting to enable app:", appId);
    console.log("📊 Current enabled apps before:", enabledApps);
    console.log("📊 Current config before:", config);
    console.log("📊 Current apps config before:", config.apps);
    console.log("📊 Current installed field before:", config.apps?.installed);
    
    setIsEnabling(true);
    try {
      // Always enable required apps first
      const configUpdate: Record<string, any> = {
        apps: {
          installed: { ...config.apps?.installed } // Preserve existing data
        }
      };
      
      console.log("🔧 Preserving existing apps.installed data:", config.apps?.installed);
      
      // Enable the target app
      configUpdate.apps.installed[appId] = { enabled: true };
      console.log(`🔧 Will enable ${appId}`);
      
      // Enable only the apps required by schema validation
      if (!enabledApps['authentication']?.enabled) {
        configUpdate.apps.installed.authentication = { enabled: true };
        console.log("🔐 Will enable authentication");
      } else {
        console.log("🔐 Authentication already enabled");
      }
      if (!enabledApps['emails']?.enabled) {
        configUpdate.apps.installed.emails = { enabled: true };
        console.log("📧 Will enable emails");
      } else {
        console.log("📧 Emails already enabled");
      }
      
      console.log("📝 Config update payload:", configUpdate);
      console.log("📝 Config update payload keys:", Object.keys(configUpdate));
      console.log("📝 Config update payload values:", Object.values(configUpdate));
      
      console.log("🔄 Calling project.updateConfig...");
      const result = await project.updateConfig(configUpdate);
      console.log("📊 Config update result:", result);
      console.log("📊 Config update result type:", typeof result);
      
      console.log("✅ Config update successful!");
      
      // Wait a moment for the config to propagate
      console.log("⏳ Waiting for config to propagate...");
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if the config actually changed
      console.log("🔍 Config update completed - will check on next render");
      
      // Close dialog after successful enable
      setIsDialogOpen(false);
    } catch (error) {
      console.error("❌ Failed to enable app:", error);
      console.error("Error details:", error);
      console.error("Error stack:", error.stack);
      // TODO: Show user-friendly error message
    } finally {
      setIsEnabling(false);
    }
  };

  return (
    <PageLayout
      title="Explore Apps"
      description="Discover and enable new apps to extend your project's functionality"
    >
      <div className="space-y-8">
        {/* Enabled Apps Section */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Enabled Apps</h2>
          {enabledRegularApps.length > 0 ? (
            <AppGrid
              apps={enabledRegularApps}
              onAppClick={handleAppClick}
              variant="enabled"
            />
          ) : (
            <p className="text-muted-foreground">No apps enabled yet.</p>
          )}
        </div>

        {/* Available Apps Section */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Available Apps</h2>
          <AppGrid
            apps={availableRegularApps}
            onAppClick={handleAppClick}
            variant="available"
          />
        </div>

        {/* Integrations Section */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Integrations</h2>
          <div className="space-y-4">
            {enabledIntegrations.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-2">Enabled</h3>
                <AppGrid
                  apps={enabledIntegrations}
                  onAppClick={handleAppClick}
                  variant="enabled"
                />
              </div>
            )}
            {availableIntegrations.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-2">Available</h3>
                <AppGrid
                  apps={availableIntegrations}
                  onAppClick={handleAppClick}
                  variant="available"
                />
              </div>
            )}
          </div>
        </div>

        {/* App Detail Dialog */}
        {selectedApp && (
          <AppDetailDialog
            appId={selectedApp}
            isOpen={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onEnable={handleEnableApp}
            isEnabled={enabledApps[selectedApp]?.enabled || false}
            isEnabling={isEnabling}
          />
        )}
      </div>
    </PageLayout>
  );
}
