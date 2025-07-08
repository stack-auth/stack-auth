"use client";

import { SettingCard } from "@/components/settings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { ActionDialog, Button, Card, Separator, Typography } from "@stackframe/stack-ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type ThemeType = 'default-light' | 'default-dark';

type Theme = {
  id: ThemeType,
  name: string,
};

const themes: Theme[] = [
  {
    id: 'default-light',
    name: 'Light Theme',
  },
  {
    id: 'default-dark',
    name: 'Dark Theme',
  },
];

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const activeTheme = project.config.emailTheme;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSelectedTheme, setDialogSelectedTheme] = useState<ThemeType>(activeTheme);

  const handleThemeSelect = (themeId: ThemeType) => {
    setDialogSelectedTheme(themeId);
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

  const selectedThemeData = themes.find(t => t.id === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

  return (
    <PageLayout title="Email Themes" description="Customize email themes for your project">
      <SettingCard
        title="Active Theme"
        description={`Currently using ${selectedThemeData.name}`}
      >
        <ThemePreview themeId={activeTheme} />
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
                key={theme.id}
                theme={theme}
                isSelected={dialogSelectedTheme === theme.id}
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
  theme: Theme,
  isSelected: boolean,
  onSelect: (themeId: ThemeType) => void,
}) {
  return (
    <Card
      className="cursor-pointer hover:ring-1 transition-all"
      onClick={() => onSelect(theme.id)}
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <Typography className="font-medium text-lg">{theme.name}</Typography>
          {isSelected && (
            <div className="bg-blue-500 text-white rounded-full w-6 h-6 p-1 flex items-center justify-center">
              <Check />
            </div>
          )}
        </div>
        <Separator className="my-3" />
        <ThemePreview themeId={theme.id} />
      </div>
    </Card>
  );
}

function ThemePreview({ themeId }: { themeId: ThemeType }) {
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
  const previewHtml = stackAdminApp.useEmailThemePreview(themeId, previewEmailHtml);
  return (
    <iframe srcDoc={previewHtml} className="mx-auto pointer-events-none" />
  );
}
