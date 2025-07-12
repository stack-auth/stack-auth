"use client";

import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import ThemePreview from "@/components/theme-preview";
import { ActionDialog, Button, Card, toast, Typography } from "@stackframe/stack-ui";
import { FormDialog } from "@/components/form-dialog";
import { Check } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { InputField } from "@/components/form-fields";
import * as yup from "yup";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";

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

  const selectedThemeData = themes.find(t => t.displayName === activeTheme) ?? throwErr(`Unknown theme ${activeTheme}`, { activeTheme });

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
          <div className="grid grid-cols-2 gap-6">
            {themes.map((theme) => (
              <ThemeOption
                key={theme.id}
                theme={theme}
                isSelected={dialogSelectedTheme === theme.displayName}
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
  onSelect: (themeName: string) => void,
}) {

  return (
    <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => onSelect(theme.displayName)}>
      <div className="w-full h-60 shadow-md rounded-md overflow-clip group-hover:shadow-lg transition-all" style={{ zoom: 0.75 }}>
        <ThemePreview themeId={theme.id} disableFrame />
      </div>
      <div className="flex items-center gap-2">
        {isSelected && <Check />}
        <Typography variant="secondary" >{theme.displayName}</Typography>
      </div>
    </div>
  )
}

function NewThemeButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewTheme = async (values: { name: string }) => {
    try {
      const { id } = await stackAdminApp.createEmailTheme(values.name);
      router.push(`email-themes/${id}`);
    } catch (error) {
      if (KnownErrors.ThemeWithNameAlreadyExists.isInstance(error)) {
        toast({
          title: "Theme with this name already exists",
          description: "Please choose a different name",
          variant: "destructive",
        });
        return 'prevent-close';
      }
    }
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
