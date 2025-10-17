"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppSquare } from "@/components/app-square";
import { ALL_APPS, ALL_APP_TAGS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();

  // Get installed apps
  const installedApps = Object.entries(config.apps.installed)
    .filter(([_, appConfig]) => appConfig.enabled)
    .map(([appId]) => appId as AppId);

  // Group apps by tag
  const appsByTag = new Map<string, AppId[]>();

  Object.entries(ALL_APPS).forEach(([appId, app]) => {
    app.tags.forEach(tag => {
      if (!appsByTag.has(tag)) {
        appsByTag.set(tag, []);
      }
      appsByTag.get(tag)?.push(appId as AppId);
    });
  });

  return (
    <PageLayout
      title="Explore apps"
      fillWidth
    >
      {/* Installed Apps Section */}
      <section>
        <h2 className="font-bold my-4">Installed</h2>
        {installedApps.length > 0 ? (
          <div className="flex gap-1 lg:gap-8 flex-wrap">
            {installedApps.map(appId => (
              <AppSquare key={appId} appId={appId} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">No apps installed yet.</p>
        )}
      </section>

      {/* Apps by Tag Sections */}
      {Array.from(appsByTag.entries()).filter(([_, apps]) => apps.some(appId => ALL_APPS[appId].stage !== "alpha")).map(([tag, apps]) => (
        <section key={tag}>
          <h2 className="font-bold my-4">{ALL_APP_TAGS[tag as keyof typeof ALL_APP_TAGS].displayName}</h2>
          <div className="flex gap-1 lg:gap-8 flex-wrap">
            {apps.filter(appId => ALL_APPS[appId].stage !== "alpha").map(appId => (
              <AppSquare key={appId} appId={appId} />
            ))}
          </div>
        </section>
      ))}
    </PageLayout>
  );
}
