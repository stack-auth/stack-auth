"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import ThemePreview from "@/components/theme-preview";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { ActionDialog, Button, Card, Typography } from "@stackframe/stack-ui";
import { Check } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const themes = stackAdminApp.useEmailThemes();
  const activeTheme = project.config.emailTheme;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSelectedThemeId, setDialogSelectedThemeId] = useState<string>(activeTheme);

  const handleThemeSelect = (themeId: string) => {
    setDialogSelectedThemeId(themeId);
  };

  const handleSaveTheme = async () => {
    await project.update({
      config: { emailTheme: dialogSelectedThemeId }
    });
  };

  const handleOpenDialog = () => {
    setDialogSelectedThemeId(activeTheme);
    setDialogOpen(true);
  };

  const selectedThemeData = themes.find(t => t.id === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

  return (
    <PageLayout
      title="Email Themes"
      description="Customize email themes for your project"
      actions={<NewThemeButton />}
    >
      <SettingCard
        title="Active Theme"
        description={`Currently using ${selectedThemeData.displayName}`}
      >
        <div className="h-72">
          <ThemePreview themeId={selectedThemeData.id} />
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
                isSelected={dialogSelectedThemeId === theme.id}
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
  theme: { id: string, displayName: string },
  isSelected: boolean,
  onSelect: (themeId: string) => void,
}) {
  return (
    <Card
      className="cursor-pointer hover:ring-1 transition-all"
      onClick={() => onSelect(theme.id)}
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <Typography variant="secondary">{theme.displayName}</Typography>
          {isSelected && (
            <div className="bg-blue-500 text-white rounded-full w-6 h-6 p-1 flex items-center justify-center">
              <Check />
            </div>
          )}
        </div>
        <div className="h-60" style={{ zoom: 0.75 }}>
          <ThemePreview themeId={theme.id} disableFrame />
        </div>
      </div>
    </Card>
  );
}

function NewThemeButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewTheme = async (values: { name: string }) => {
    const { id } = await stackAdminApp.createEmailTheme(values.name);
    router.push(`email-themes/${id}`);
  };

  return (
    <FormDialog
      title="New Theme"
      trigger={<Button>New Theme</Button>}
      onSubmit={handleCreateNewTheme}
      formSchema={yup.object({
        name: yup.string().defined(),
      })}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Theme Name"
          placeholder="Enter theme name"
          required
        />
      )}
    />
  );
}
