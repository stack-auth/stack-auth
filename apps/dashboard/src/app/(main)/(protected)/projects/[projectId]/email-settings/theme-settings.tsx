"use client";

import EmailPreview from "@/components/email-preview";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { Button } from "@/components/ui";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { useAdminApp } from "../use-admin-app";

export function ThemeSettings() {
  const router = useRouter();
  const stackAdminApp = useAdminApp();
  const config = stackAdminApp.useProject().useConfig();
  const themes = stackAdminApp.useEmailThemes();
  const activeTheme = config.emails.selectedThemeId;
  const selectedThemeData = themes.find(t => t.id === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

  return (
    <SettingCard
      title="Active Theme"
      description={selectedThemeData.displayName}
      actions={
        <Button onClick={() => router.push("email-themes")} size="sm" variant="outline" className="gap-1.5">
          <span>Manage Themes</span>
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="h-96 rounded-md overflow-hidden border">
        <EmailPreview themeId={selectedThemeData.id} templateTsxSource={previewTemplateSource} />
      </div>
    </SettingCard>
  );
}
