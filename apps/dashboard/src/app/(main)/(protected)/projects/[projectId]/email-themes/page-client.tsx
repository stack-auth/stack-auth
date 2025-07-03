"use client";

import { SettingCard } from "@/components/settings";
import { ActionDialog, Button, Card, Separator, Typography } from "@stackframe/stack-ui";
import { ReactNode, useState } from "react";
import { PageLayout } from "../page-layout";
import { LightEmailTheme, DarkEmailTheme } from "@stackframe/stack-emails/dist/themes/index";
import { Check } from "lucide-react";
import { useAdminApp } from "../use-admin-app";

type ThemeType = 'light' | 'dark';

type Theme = {
  id: ThemeType,
  name: string,
  component: React.ComponentType<{ children: ReactNode }>,
};

const themes: Theme[] = [
  {
    id: 'light',
    name: 'Light Theme',
    component: LightEmailTheme
  },
  {
    id: 'dark',
    name: 'Dark Theme',
    component: DarkEmailTheme
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

  const selectedThemeData = themes.find(t => t.id === activeTheme)!;
  const CurrentThemeComponent = selectedThemeData.component;

  return (
    <PageLayout title="Email Themes" description="Customize email themes for your project">
      <SettingCard
        title="Active Theme"
        description={`Currently using ${selectedThemeData.name}`}
      >
        <div className="rounded-md border-primary-500 border w-fit mx-auto">
          <CurrentThemeComponent>
            <EmailPreview />
          </CurrentThemeComponent>
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
  const ThemeComponent = theme.component;

  return (
    <Card
      className={`cursor-pointer hover:ring-1 transition-all`}
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
        <ThemeComponent>
          <EmailPreview />
        </ThemeComponent>
      </div>
    </Card>
  );
}

function EmailPreview() {
  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">
        Header text
      </h2>
      <p className="mb-4">
        Body text content with some additional information.
      </p>
      <div className="text-center my-6">
        <Button>Button</Button>
      </div>
    </div>
  );
}
