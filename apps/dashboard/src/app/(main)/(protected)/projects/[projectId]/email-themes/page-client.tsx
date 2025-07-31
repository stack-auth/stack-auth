"use client";

import EmailPreview from "@/components/email-preview";
import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { ActionDialog, Button, Typography } from "@stackframe/stack-ui";
import { Check, Pencil } from "lucide-react";
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
          <EmailPreview themeId={selectedThemeData.id} templateTsxSource={previewTemplateSource} />
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
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  return (
    <div className="relative flex flex-col items-center gap-2 group cursor-pointer" onClick={() => onSelect(theme.id)}>
      <div className="w-full h-60 shadow-md rounded-md overflow-clip group-hover:shadow-lg transition-all" style={{ zoom: 0.75 }}>
        <EmailPreview themeId={theme.id} templateTsxSource={previewTemplateSource} disableResizing />
      </div>
      <div className="flex items-center gap-2">
        {isSelected && <Check />}
        <Typography variant="secondary" >{theme.displayName}</Typography>
      </div>
      <Link href={`/projects/${project.id}/email-themes/${theme.id}`}>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 bg-secondary opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Pencil className="w-4 h-4" />
        </Button>
      </Link>
    </div>
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
