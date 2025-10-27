'use client';

import { AppIcon } from "@/components/app-square";
import { ALL_APPS_FRONTEND } from "@/lib/apps-frontend";
import { ALL_APPS, ALL_APP_TAGS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Badge, Button, ScrollArea } from "@stackframe/stack-ui";
import Image from "next/image";
import { FunctionComponent } from "react";

export function AppStoreEntry({
  appId,
  onEnable,
  titleComponent: TitleComponent = "h1",
}: {
  appId: AppId,
  onEnable: () => Promise<void>,
  titleComponent?: FunctionComponent<any> | string,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  return (
    <div className="flex flex-col h-full">
      {/* Header with app icon and basic info */}
      <div className="p-6 border-b">
        <div className="flex gap-4">
          <AppIcon appId={appId} className="w-24 h-24 shadow-md" />
          <div className="flex-1">
            <TitleComponent className="text-2xl font-bold mb-1">{app.displayName}</TitleComponent>
            <p className="text-gray-600 dark:text-gray-400 mb-2">{app.subtitle}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {app.tags.map((tag) => (
                <Badge key={tag} variant={tag === "expert" ? "destructive" : "outline"} >{ALL_APP_TAGS[tag].displayName}</Badge>
              ))}
            </div>
          </div>
          <div className="text-right">
            <Button
              onClick={onEnable}
              size="lg"
              className="px-8"
            >
              Enable
            </Button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              No additional cost
            </p>
          </div>
        </div>
      </div>

      {/* Screenshots */}
      <div className="border-b">
        <ScrollArea className="w-full">
          <div className="flex gap-4 p-6">
            {appFrontend.screenshots.map((screenshot, index) => (
              <div
                key={index}
                className="relative h-48 w-72 rounded-lg shadow-md flex-shrink-0 overflow-hidden"
              >
                <Image
                  src={screenshot}
                  alt={`${app.displayName} screenshot ${index + 1}`}
                  fill
                  className="object-cover select-none"
                  draggable={false}
                />
              </div>
            ))}
            {appFrontend.screenshots.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No screenshots available.</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Long description */}
      <ScrollArea className="flex-1 p-6">
        <div className="prose dark:prose-invert max-w-none">
          {app.stage === "alpha" && (
            <p className="text-red-500 dark:text-red-400 bg-red-500/10 p-2 rounded-md text-sm text-center">
              IMPORTANT: This app is in alpha. It is still under development, and may break in unexpected ways.
            </p>
          )}
          {app.stage === "beta" && (
            <p className="text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 p-2 rounded-md text-sm text-center">
              IMPORTANT: This app is in beta. You may still experience some bugs and issues.
            </p>
          )}
          {appFrontend.storeDescription}
        </div>
      </ScrollArea>
    </div>
  );
}
