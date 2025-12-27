"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, Typography, cn } from "@/components/ui";
import { WarningCircleIcon, EnvelopeSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const emailTemplates = stackAdminApp.useEmailTemplates();
  const router = useRouter();
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<string | null>(null);

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Email Templates"
        description="Customize the emails sent to your users"
        actions={<NewTemplateButton />}
      >
        {emailConfig?.type === 'shared' && (
          <Alert className="bg-orange-500/5 border-orange-500/20 text-orange-600 dark:text-orange-400">
            <WarningCircleIcon className="h-4 w-4" />
            <AlertTitle className="font-semibold">Warning</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          {emailTemplates.map((template) => (
            <div
              key={template.id}
              className={cn(
                "group relative flex items-center justify-between p-4 rounded-2xl transition-all duration-150 hover:transition-none",
                "bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
                "shadow-sm hover:shadow-md"
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />

              <div className="relative flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] transition-colors duration-150 group-hover:bg-foreground/[0.08] group-hover:transition-none">
                  <EnvelopeSimpleIcon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
                </div>
                <div>
                  <Typography className="font-semibold text-foreground">
                    {template.displayName}
                  </Typography>
                </div>
              </div>

              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-all duration-150 hover:transition-none"
                  onClick={() => {
                    if (emailConfig?.type === 'shared') {
                      setSharedSmtpWarningDialogOpen(template.id);
                    } else {
                      router.push(`email-templates/${template.id}`);
                    }
                  }}
                >
                  Edit Template
                </Button>
              </div>
            </div>
          ))}
        </div>

        <ActionDialog
          open={sharedSmtpWarningDialogOpen !== null}
          onClose={() => setSharedSmtpWarningDialogOpen(null)}
          title="Shared Email Server"
          okButton={{
            label: "Edit Templates Anyway", onClick: async () => {
              router.push(`email-templates/${sharedSmtpWarningDialogOpen}`);
            }
          }}
          cancelButton={{ label: "Cancel" }}
        >
          <Alert className="bg-orange-500/5 border-orange-500/20 text-orange-600 dark:text-orange-400">
            <WarningCircleIcon className="h-4 w-4" />
            <AlertTitle className="font-semibold">Warning</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
              You can edit the templates anyway, but you will not be able to save them.
            </AlertDescription>
          </Alert>
        </ActionDialog>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function NewTemplateButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewTemplate = async (values: { name: string }) => {
    const { id } = await stackAdminApp.createEmailTemplate(values.name);
    router.push(`email-templates/${id}`);
  };

  return (
    <FormDialog
      title="New Template"
      trigger={
        <Button className="gap-2">
          <PlusIcon className="h-4 w-4" />
          New Template
        </Button>
      }
      onSubmit={handleCreateNewTemplate}
      formSchema={yup.object({
        name: yup.string().defined(),
      })}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Template Name"
          placeholder="Enter template name"
          required
        />
      )}
    />
  );
}
