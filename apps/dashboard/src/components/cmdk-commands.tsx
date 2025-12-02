"use client";

import { ALL_APPS_FRONTEND, getAppPath, getItemPath } from "@/lib/apps-frontend";
import { getUninstalledAppIds } from "@/lib/apps-utils";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Blocks, Download, Globe, KeyRound, Settings, Sparkles, Zap } from "lucide-react";
import React, { useEffect, useMemo } from "react";

export type CmdKPreviewProps = {
  isSelected: boolean,
  query: string,
  registerOnFocus: (onFocus: () => void) => void,
  unregisterOnFocus: (onFocus: () => void) => void,
  /** Called when user navigates back (left arrow) from this preview */
  onBlur: () => void,
  /** Register nested commands that will appear as a new column */
  registerNestedCommands: (commands: CmdKCommand[]) => void,
  /** Navigate into the nested column (call after registering commands) */
  navigateToNested: () => void,
  /** Current nesting depth (0 = first preview) */
  depth: number,
  /** Current pathname for checking active state */
  pathname: string,
};

export type CmdKCommand = {
  id: string,
  icon: React.ReactNode,
  label: string,
  description: string,
  keywords?: string[],
  onAction: {
    type: "focus",
  } | {
    type: "action",
    action: () => void | Promise<void>,
  } | {
    type: "navigate",
    href: string,
  },
  preview: null | React.ComponentType<CmdKPreviewProps>,
  /** Optional highlight color for special styling (e.g., "purple" for AI commands) */
  highlightColor?: string,
};

// Factory to create app preview components that show navigation items
function createAppPreview(appId: AppId, projectId: string): React.ComponentType<CmdKPreviewProps> {
  // Pre-compute these outside the component since they're static per appId
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  // Pre-compute nested commands since they're static
  const IconComponent = appFrontend.icon;
  const nestedCommands: CmdKCommand[] = appFrontend.navigationItems.map((navItem) => ({
    id: `apps/${appId}/nav/${navItem.displayName.toLowerCase().replace(/\s+/g, '-')}`,
    icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
    label: navItem.displayName,
    description: app.displayName,
    keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
    onAction: { type: "navigate" as const, href: getItemPath(projectId, appFrontend, navItem) },
    preview: null,
  }));

  return function AppPreview({
    registerOnFocus,
    unregisterOnFocus,
    registerNestedCommands,
    navigateToNested,
  }: CmdKPreviewProps) {
    useEffect(() => {
      const focusHandler = () => {
        registerNestedCommands(nestedCommands);
        navigateToNested();
      };
      registerOnFocus(focusHandler);
      return () => unregisterOnFocus(focusHandler);
    }, [registerOnFocus, unregisterOnFocus, registerNestedCommands, navigateToNested]);

    return null; // No visual preview, just nested commands
  };
}

// Cache for app preview components to avoid recreating them
const appPreviewCache = new Map<string, React.ComponentType<CmdKPreviewProps>>();

function getOrCreateAppPreview(appId: AppId, projectId: string): React.ComponentType<CmdKPreviewProps> {
  const cacheKey = `${appId}:${projectId}`;
  let preview = appPreviewCache.get(cacheKey);
  if (!preview) {
    preview = createAppPreview(appId, projectId);
    appPreviewCache.set(cacheKey, preview);
  }
  return preview;
}

export function useCmdKCommands({
  projectId,
  enabledApps,
  query,
  onAskAI,
}: {
  projectId: string,
  enabledApps: AppId[],
  query: string,
  onAskAI: () => void | Promise<void>,
}): CmdKCommand[] {
  return useMemo(() => {
    const commands: CmdKCommand[] = [];

    // AI Assistant option (only when there's a query)
    if (query.trim()) {
      commands.push({
        id: "ai/ask",
        icon: <Sparkles className="h-3.5 w-3.5 text-purple-400" />,
        label: `Ask AI: "${query}"`,
        description: "Get an AI-powered answer from Stack Auth docs",
        keywords: ["ai", "assistant", "help", "question"],
        onAction: { type: "action", action: onAskAI },
        preview: null,
        highlightColor: "purple",
      });
    }

    // Overview
    commands.push({
      id: "navigation/overview",
      icon: <Globe className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Overview",
      description: "Navigation",
      keywords: ["home", "dashboard", "main"],
      onAction: { type: "navigate", href: `/projects/${projectId}` },
      preview: null,
    });

    // Installed apps - with preview for navigation items
    for (const appId of enabledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      // Some enabled apps might not have navigation metadata yet
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!app || !appFrontend) continue;

      const IconComponent = appFrontend.icon;
      const hasNavigationItems = appFrontend.navigationItems.length > 0;

      // Add the app itself as a command
      commands.push({
        id: `apps/${appId}`,
        icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
        label: app.displayName,
        description: "Installed app",
        keywords: [app.displayName.toLowerCase(), ...app.tags, "installed", "app"],
        onAction: { type: "navigate", href: getAppPath(projectId, appFrontend) },
        preview: hasNavigationItems ? getOrCreateAppPreview(appId, projectId) : null,
      });
    }

    // Available (uninstalled) apps
    const uninstalledApps = getUninstalledAppIds(enabledApps);
    for (const appId of uninstalledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      // Some apps might not have frontend metadata yet
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!app || !appFrontend) continue;

      const IconComponent = appFrontend.icon;

      commands.push({
        id: `store/${appId}`,
        icon: (
          <div className="relative">
            <IconComponent className="h-3.5 w-3.5 text-muted-foreground/50" />
            <Download className="h-2 w-2 text-muted-foreground absolute -bottom-0.5 -right-0.5" />
          </div>
        ),
        label: app.displayName,
        description: "Available to install",
        keywords: [app.displayName.toLowerCase(), ...app.tags, "available", "install", "store", "app"],
        onAction: { type: "navigate", href: `/projects/${projectId}/apps/${appId}` },
        preview: null,
      });
    }

    // Settings items
    commands.push({
      id: "settings/explore-apps",
      icon: <Blocks className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Explore Apps",
      description: "Settings",
      keywords: ["apps", "marketplace", "store", "install"],
      onAction: { type: "navigate", href: `/projects/${projectId}/apps` },
      preview: null,
    });

    commands.push({
      id: "settings/project-keys",
      icon: <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Keys",
      description: "Settings",
      keywords: ["api", "keys", "credentials", "secret"],
      onAction: { type: "navigate", href: `/projects/${projectId}/project-keys` },
      preview: null,
    });

    commands.push({
      id: "settings/project-settings",
      icon: <Settings className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Settings",
      description: "Settings",
      keywords: ["config", "configuration", "options"],
      onAction: { type: "navigate", href: `/projects/${projectId}/project-settings` },
      preview: null,
    });

    return commands;
  }, [projectId, enabledApps, query, onAskAI]);
}
