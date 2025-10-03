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
  
  // For now, assume no apps are enabled since the config schema might not be updated yet
  // TODO: Update this when the config schema is properly deployed
  const enabledApps: Record<string, { enabled: boolean }> = {};
  
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
  
  const handleAppClick = (appId: string) => {
    setSelectedApp(appId as AppId);
    setIsDialogOpen(true);
  };
  
  const handleEnableApp = async (appId: AppId) => {
    // TODO: Implement app enabling logic
    console.log("Enabling app:", appId);
    setIsDialogOpen(false);
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
          />
        )}
      </div>
    </PageLayout>
  );
}
