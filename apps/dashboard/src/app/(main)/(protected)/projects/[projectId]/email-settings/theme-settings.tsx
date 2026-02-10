"use client";

import EmailPreview from "@/components/email-preview";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { Button, Typography } from "@/components/ui";
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { useAdminApp } from "../use-admin-app";

export function ThemeSettings() {
  const router = useRouter();
  const stackAdminApp = useAdminApp();
  const config = stackAdminApp.useProject().useConfig();
  const themes = stackAdminApp.useEmailThemes();
  const activeThemeId = config.emails.selectedThemeId;
  const activeTheme = themes.find(t => t.id === activeThemeId) ?? throwErr(`Unknown theme ${activeThemeId}`, { activeThemeId });

  // Find default themes by display name (more robust than hardcoding IDs)
  const defaultLightTheme = themes.find(t => t.displayName === "Default Light");
  const defaultDarkTheme = themes.find(t => t.displayName === "Default Dark");

  // Determine the background theme:
  // - If active is dark default, show light default behind
  // - Otherwise, show dark default behind (if it exists)
  const backgroundTheme = activeTheme.displayName === "Default Dark"
    ? defaultLightTheme
    : (defaultDarkTheme ?? themes.find(t => t.id !== activeThemeId));

  return (
    <SettingCard>
      {/* Custom header with button aligned to title */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <Typography type="h3" className="font-semibold">Theme Settings</Typography>
          <Typography variant="secondary" className="text-sm mt-1">
            Create email themes - stylistic defaults that can be applied across multiple emails
          </Typography>
        </div>
        <Button onClick={() => router.push("email-themes")} size="sm" variant="outline" className="gap-1.5 shrink-0">
          <span>Manage Themes</span>
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Stacked preview container - side by side with overlap like reference */}
      <div className="relative h-[460px]">
        {/* Background theme (right side, behind, peeks from top) */}
        {backgroundTheme && (
          <div
            className="absolute right-0 top-0 w-[55%] h-[310px] rounded-xl overflow-hidden border border-border shadow-md"
            style={{ zIndex: 1 }}
          >
            <EmailPreview themeId={backgroundTheme.id} templateTsxSource={previewTemplateSource} disableResizing />
          </div>
        )}

        {/* Active theme (left side, front, prominent, positioned lower) */}
        <div
          className="absolute left-0 top-14 w-[55%] h-[340px] rounded-xl overflow-hidden border border-border shadow-xl bg-background"
          style={{ zIndex: 2 }}
        >
          <EmailPreview themeId={activeTheme.id} templateTsxSource={previewTemplateSource} disableResizing />
          {/* Active indicator - green circle with checkmark */}
          <div className="absolute top-3 left-3 z-10 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md">
            <CheckIcon className="w-3.5 h-3.5 text-white" weight="bold" />
          </div>
        </div>

        {/* Active theme label */}
        <div className="absolute bottom-0 left-0">
          <Typography variant="secondary" className="text-sm">
            Active: <span className="font-medium text-foreground">{activeTheme.displayName}</span>
          </Typography>
        </div>
      </div>
    </SettingCard>
  );
}
