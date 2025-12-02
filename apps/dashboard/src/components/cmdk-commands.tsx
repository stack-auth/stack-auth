"use client";

import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Blocks, Globe, KeyRound, Settings } from "lucide-react";
import React, { useMemo } from "react";

export type CmdKCommand = {
  id: string,
  icon: React.ReactNode,
  label: string,
  description: string,
  keywords?: string[],
  onSelect: {
    type: "preview",
  } | {
    type: "action",
    action: () => void | Promise<void>,
  } | {
    type: "navigate",
    href: string,
  },
  preview: null | React.ComponentType<{
    isSelected: boolean,
    registerOnFocus: (onFocus: () => void) => void,
    unregisterOnFocus: (onFocus: () => void) => void,
  }>,
};

export function useCmdKCommands({
  projectId,
  enabledApps,
}: {
  projectId: string,
  enabledApps: AppId[],
}): CmdKCommand[] {
  return useMemo(() => {
    const commands: CmdKCommand[] = [];

    // Overview
    commands.push({
      id: "overview",
      icon: <Globe className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Overview",
      description: "Navigation",
      keywords: ["home", "dashboard", "main"],
      onSelect: { type: "navigate", href: `/projects/${projectId}` },
      preview: null,
    });

    // App navigation items
    for (const appId of enabledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      // Some enabled apps might not have navigation metadata yet
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!app || !appFrontend) continue;

      const IconComponent = appFrontend.icon;

      for (const navItem of appFrontend.navigationItems) {
        commands.push({
          id: `${appId}-${navItem.displayName}`,
          icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
          label: navItem.displayName,
          description: app.displayName,
          keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
          onSelect: { type: "navigate", href: getItemPath(projectId, appFrontend, navItem) },
          preview: null,
        });
      }
    }

    // Settings items
    commands.push({
      id: "explore-apps",
      icon: <Blocks className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Explore Apps",
      description: "Settings",
      keywords: ["apps", "marketplace", "store", "install"],
      onSelect: { type: "navigate", href: `/projects/${projectId}/apps` },
      preview: null,
    });

    commands.push({
      id: "project-keys",
      icon: <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Keys",
      description: "Settings",
      keywords: ["api", "keys", "credentials", "secret"],
      onSelect: { type: "navigate", href: `/projects/${projectId}/project-keys` },
      preview: null,
    });

    commands.push({
      id: "project-settings",
      icon: <Settings className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Settings",
      description: "Settings",
      keywords: ["config", "configuration", "options"],
      onSelect: { type: "navigate", href: `/projects/${projectId}/project-settings` },
      preview: null,
    });

    return commands;
  }, [projectId, enabledApps]);
}
