"use client";

import { useRouter } from "@/components/router";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, Card, Typography } from "@stackframe/stack-ui";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const emailTemplates = stackAdminApp.useNewEmailTemplates();
  const router = useRouter();
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<string | null>(null);

  return (
    <PageLayout title="Email Templates" description="Customize the emails sent to your users">
      {emailConfig?.type === 'shared' && <Alert variant="default">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>
          You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
        </AlertDescription>
      </Alert>}
      {emailTemplates.map((template) => (
        <Card key={template.id} className="p-4 flex justify-between flex-col sm:flex-row gap-4">
          <div className="flex flex-col gap-2">
            <div>
              <Typography className="font-medium">
                {template.displayName}
              </Typography>
              <Typography type='label' variant='secondary'>
                Subject: {template.subject}
              </Typography>
            </div>
            <div className="flex-grow flex justify-start items-end gap-2">
              <Button
                variant='secondary'
                onClick={() => {
                  if (emailConfig?.type === 'shared') {
                    setSharedSmtpWarningDialogOpen(template.id);
                  } else {
                    router.push(`email-templates-new/${template.id}`);
                  }
                }}
              >
                Edit Template
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <ActionDialog
        open={sharedSmtpWarningDialogOpen !== null}
        onClose={() => setSharedSmtpWarningDialogOpen(null)}
        title="Shared Email Server"
        okButton={{
          label: "Edit Templates Anyway", onClick: async () => {
            router.push(`email-templates-new/${sharedSmtpWarningDialogOpen}`);
          }
        }}
        cancelButton={{ label: "Cancel" }}
      >
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
            You can edit the templates anyway, but you will not be able to save them.
          </AlertDescription>
        </Alert>
      </ActionDialog>
    </PageLayout>
  );
}
