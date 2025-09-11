"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, Card, Typography } from "@stackframe/stack-ui";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const router = useRouter();
  const drafts = stackAdminApp.useEmailDrafts();
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<string | null>(null);

  return (
    <PageLayout
      title="Email Drafts"
      description="Create, edit, and send email drafts"
      actions={<NewDraftButton />}
    >
      {emailConfig?.type === 'shared' && <Alert variant="default">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>
          You are using a shared email server. If you want to send manual emails, you need to configure a custom SMTP server.
        </AlertDescription>
      </Alert>}

      {drafts.map((draft: any) => (
        <Card key={draft.id} className="p-4">
          <div className="flex justify-between gap-2 items-center">
            <Typography className="font-medium">
              {draft.displayName}
            </Typography>
            <div className="flex justify-start items-end gap-2">
              <Button
                variant='secondary'
                onClick={() => {
                  if (emailConfig?.type === 'shared') {
                    setSharedSmtpWarningDialogOpen(draft.id);
                  } else {
                    router.push(`email-drafts/${draft.id}`);
                  }
                }}
              >
                Open Draft
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
          label: "Open Draft Anyway", onClick: async () => {
            router.push(`email-drafts/${sharedSmtpWarningDialogOpen}`);
          }
        }}
        cancelButton={{ label: "Cancel" }}
      >
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. You can open the draft anyway, but you will not be able to send emails.
          </AlertDescription>
        </Alert>
      </ActionDialog>
    </PageLayout>
  );
}

function NewDraftButton() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewDraft = async (values: { name: string }) => {
    const draft = await stackAdminApp.createEmailDraft({ displayName: values.name });
    router.push(`email-drafts/${draft.id}`);
  };

  return (
    <FormDialog
      title="New Draft"
      trigger={<Button>New Draft</Button>}
      onSubmit={handleCreateNewDraft}
      formSchema={yup.object({
        name: yup.string().defined(),
      })}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Draft Name"
          placeholder="Enter draft name"
          required
        />
      )}
    />
  );
}

