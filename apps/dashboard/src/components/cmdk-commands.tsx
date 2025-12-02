"use client";

import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Blocks, Globe, KeyRound, Settings, Sparkles, Zap } from "lucide-react";
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

// Test Preview Component with nested navigation demo
function TestPreview({
  isSelected,
  query,
  registerOnFocus,
  unregisterOnFocus,
  registerNestedCommands,
  navigateToNested,
}: CmdKPreviewProps) {
  // Create nested commands for this preview
  const nestedCommands: CmdKCommand[] = useMemo(() => [
    {
      id: "test/preview/nested-1",
      icon: <Zap className="h-3.5 w-3.5 text-green-400" />,
      label: "Nested Item 1",
      description: "A nested command item",
      keywords: ["nested", "item", "one"],
      onAction: { type: "navigate", href: `/test/nested-1` },
      preview: null,
    },
    {
      id: "test/preview/nested-2",
      icon: <Zap className="h-3.5 w-3.5 text-green-400" />,
      label: "Nested Item 2",
      description: "Another nested command",
      keywords: ["nested", "item", "two"],
      onAction: { type: "navigate", href: `/test/nested-2` },
      preview: null,
    },
    {
      id: "test/preview/nested-3",
      icon: <Zap className="h-3.5 w-3.5 text-green-400" />,
      label: "Nested Item 3",
      description: "Yet another nested command",
      keywords: ["nested", "item", "three"],
      onAction: { type: "navigate", href: `/test/nested-3` },
      preview: null,
    },
  ], []);

  useEffect(() => {
    const focusHandler = () => {
      // When this preview receives focus (arrow right), register nested commands
      registerNestedCommands(nestedCommands);
      navigateToNested();
    };
    registerOnFocus(focusHandler);
    return () => unregisterOnFocus(focusHandler);
  }, [registerOnFocus, unregisterOnFocus, registerNestedCommands, navigateToNested, nestedCommands]);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground mb-2">Preview Test Command</h3>
        <p className="text-sm text-muted-foreground">
          This is a preview component that demonstrates nested navigation.
          Press → to navigate into the nested list.
        </p>
        {query && (
          <p className="text-xs text-muted-foreground/70 mt-2">
            Current query: &quot;{query}&quot;
          </p>
        )}
      </div>
      <div className="flex-1 space-y-3">
        <div className="p-4 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06]">
          <div className="text-sm font-medium text-foreground mb-1">Feature 1</div>
          <div className="text-xs text-muted-foreground">This is a preview of feature 1</div>
        </div>
        <div className="p-4 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06]">
          <div className="text-sm font-medium text-foreground mb-1">Feature 2</div>
          <div className="text-xs text-muted-foreground">This is a preview of feature 2</div>
        </div>
        <div className="p-4 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06]">
          <div className="text-sm font-medium text-foreground mb-1">Feature 3</div>
          <div className="text-xs text-muted-foreground">This is a preview of feature 3</div>
        </div>
      </div>
      {isSelected && (
        <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="text-xs text-blue-400 font-medium">Press → to see nested items, Enter to execute</div>
        </div>
      )}
    </div>
  );
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

    // Test command with preview
    commands.push({
      id: "test/preview",
      icon: <Zap className="h-3.5 w-3.5 text-blue-400" />,
      label: "Preview Test Command",
      description: "Test command with preview component",
      keywords: ["test", "preview", "demo", "example"],
      onAction: { type: "focus" },
      preview: TestPreview,
      highlightColor: "blue",
    });

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
          id: `apps/${appId}/pages/${navItem.displayName.toLowerCase().replace(/\s+/g, '-')}`,
          icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
          label: navItem.displayName,
          description: app.displayName,
          keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
          onAction: { type: "navigate", href: getItemPath(projectId, appFrontend, navItem) },
          preview: null,
        });
      }
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
