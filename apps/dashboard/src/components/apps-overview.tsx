"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Link } from "@/components/link";
import { getIntegrations, getRegularApps } from "@/lib/apps";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@stackframe/stack-ui";
import { ExternalLink, Plus } from "lucide-react";

interface AppsOverviewProps {
  projectId: string;
}

export function AppsOverview({ projectId }: AppsOverviewProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  
  // Read enabled apps from project configuration
  // Handle both old structure (availableApps) and new structure (installed)
  const enabledApps = config.apps?.installed || {};
  
  // Debug logging
  console.log("🔍 AppsOverview Debug:");
  console.log("- Full config:", config);
  console.log("- Apps config:", config.apps);
  console.log("- Apps config keys:", Object.keys(config.apps || {}));
  console.log("- Available apps:", config.apps?.availableApps);
  console.log("- Installed apps:", config.apps?.installed);
  console.log("- Enabled apps:", enabledApps);
  
  // Check if the config update actually worked
  console.log("🔍 Config Structure Analysis:");
  console.log("- Has apps field:", !!config.apps);
  console.log("- Apps field type:", typeof config.apps);
  console.log("- Apps field keys:", config.apps ? Object.keys(config.apps) : "N/A");
  console.log("- Has installed field:", !!config.apps?.installed);
  console.log("- Installed field type:", typeof config.apps?.installed);
  console.log("- Installed field value:", config.apps?.installed);
  
  const regularApps = getRegularApps();
  const integrations = getIntegrations();
  
  const enabledRegularApps = regularApps.filter(app => enabledApps[app.id]?.enabled);
  const availableRegularApps = regularApps.filter(app => !enabledApps[app.id]?.enabled);
  
  const enabledIntegrations = integrations.filter(app => enabledApps[app.id]?.enabled);
  const availableIntegrations = integrations.filter(app => !enabledApps[app.id]?.enabled);
  
  // Debug logging for app states
  console.log("📊 App States:");
  console.log("- Regular apps:", regularApps.map(app => ({ id: app.id, enabled: enabledApps[app.id]?.enabled })));
  console.log("- Enabled regular apps:", enabledRegularApps.map(app => app.id));
  console.log("- Available regular apps:", availableRegularApps.map(app => app.id));
  console.log("- Enabled integrations:", enabledIntegrations.map(app => app.id));
  console.log("- Available integrations:", availableIntegrations.map(app => app.id));
  
  const totalEnabled = enabledRegularApps.length + enabledIntegrations.length;
  const totalAvailable = availableRegularApps.length + availableIntegrations.length;
  
  // Debug logging for totals
  console.log("📈 Totals:");
  console.log("- Total enabled:", totalEnabled);
  console.log("- Total available:", totalAvailable);
  console.log("- Will show enabled section:", totalEnabled > 0);
  console.log("- Will show available section:", totalAvailable > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Apps</CardTitle>
          <Link href={`/projects/${projectId}/apps/explore`}>
            <Button variant="outline" size="sm">
              <Plus size={16} className="mr-2" />
              Explore Apps
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Enabled Apps */}
          {totalEnabled > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Enabled ({totalEnabled})
              </h4>
              <div className="flex flex-wrap gap-2">
                {enabledRegularApps.map((app) => {
                  const IconComponent = app.icon;
                  return (
                    <div
                      key={app.id}
                      className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg"
                    >
                      <IconComponent size={16} className="text-green-600" />
                      <span className="text-sm font-medium text-green-800">
                        {app.displayName}
                      </span>
                    </div>
                  );
                })}
                {enabledIntegrations.map((app) => {
                  const IconComponent = app.icon;
                  return (
                    <div
                      key={app.id}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg"
                    >
                      <IconComponent size={16} className="text-blue-600" />
                      <span className="text-sm font-medium text-blue-800">
                        {app.displayName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available Apps Preview */}
          {totalAvailable > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Available ({totalAvailable})
              </h4>
              <div className="flex flex-wrap gap-2">
                {[...availableRegularApps, ...availableIntegrations]
                  .slice(0, 6)
                  .map((app) => {
                    const IconComponent = app.icon;
                    return (
                      <div
                        key={app.id}
                        className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-lg"
                      >
                        <IconComponent size={16} className="text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {app.displayName}
                        </span>
                      </div>
                    );
                  })}
                {totalAvailable > 6 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-lg">
                    <span className="text-sm text-muted-foreground">
                      +{totalAvailable - 6} more
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* No Apps State */}
          {totalEnabled === 0 && totalAvailable === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                No apps available yet.
              </p>
              <Link href={`/projects/${projectId}/apps/explore`}>
                <Button>
                  <Plus size={16} className="mr-2" />
                  Explore Apps
                </Button>
              </Link>
            </div>
          )}

          {/* Quick Actions */}
          {totalAvailable > 0 && (
            <div className="pt-2 border-t">
              <Link href={`/projects/${projectId}/apps/explore`}>
                <Button variant="outline" size="sm" className="w-full">
                  <ExternalLink size={16} className="mr-2" />
                  View All Available Apps
                </Button>
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
