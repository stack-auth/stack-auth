"use client";

import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { ActionDialog, Button, Card, Typography } from "@stackframe/stack-ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const themes = stackAdminApp.useEmailThemes();
  const activeTheme = project.config.emailTheme;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSelectedTheme, setDialogSelectedTheme] = useState<string>(activeTheme);

  const handleThemeSelect = (themeName: string) => {
    setDialogSelectedTheme(themeName);
  };

  const handleSaveTheme = async () => {
    await project.update({
      config: { emailTheme: dialogSelectedTheme }
    });
  };

  const handleOpenDialog = () => {
    setDialogSelectedTheme(activeTheme);
    setDialogOpen(true);
  };

  const selectedThemeData = themes.find(t => t.name === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

  return (
    <PageLayout
      title="Email Themes"
      description="Customize email themes for your project"
      actions={<NewThemeButton />}
    >
      <SettingCard
        title="Active Theme"
        description={`Currently using ${selectedThemeData.name}`}
      >
        <div className="h-72">
          <ThemePreview themeName={activeTheme} />
        </div>
        <ActionDialog
          trigger={<Button onClick={handleOpenDialog} className="ml-auto w-min">Set Theme</Button>}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Select Email Theme"
          cancelButton
          okButton={{
            label: "Save Theme",
            onClick: handleSaveTheme
          }}
        >
          <div className="space-y-4">
            {themes.map((theme) => (
              <ThemeOption
                key={theme.name}
                theme={theme}
                isSelected={dialogSelectedTheme === theme.name}
                onSelect={handleThemeSelect}
              />
            ))}
          </div>
        </ActionDialog>
      </SettingCard>
    </PageLayout>
  );
}

function ThemeOption({
  theme,
  isSelected,
  onSelect
}: {
  theme: { name: string },
  isSelected: boolean,
  onSelect: (themeName: string) => void,
}) {
  return (
    <Card
      className="cursor-pointer hover:ring-1 transition-all"
      onClick={() => onSelect(theme.name)}
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <Typography variant="secondary">{theme.name}</Typography>
          {isSelected && (
            <div className="bg-blue-500 text-white rounded-full w-6 h-6 p-1 flex items-center justify-center">
              <Check />
            </div>
          )}
        </div>
        <div className="h-60" style={{ zoom: 0.75 }}>
          <ThemePreview themeName={theme.name} />
        </div>
      </div>
    </Card>
  );
}

function ThemePreview({ themeName }: { themeName: string }) {
  const previewEmailHtml = deindent`
    <div>
      <h2 className="mb-4 text-2xl font-bold">
        Header text
      </h2>
      <p className="mb-4">
        Body text content with some additional information.
      </p>
    </div>
  `;
  const stackAdminApp = useAdminApp();
  const previewHtml = stackAdminApp.useEmailThemePreview(themeName, previewEmailHtml);
  return (
    <iframe srcDoc={previewHtml} className="mx-auto pointer-events-none h-full" />
  );
}

function NewThemeButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleCreateNewTheme = async () => {
    setLoading(true);
    try {
      const devServer = await stackAdminApp.createEmailThemeDevServer();
      router.push(`email-themes/new/${devServer.repoId}`);
    } catch (error) {
      console.error("Failed to create new theme:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={() => runAsynchronously(handleCreateNewTheme())}
      loading={loading}
    >
      New Theme
    </Button>
  );
}
