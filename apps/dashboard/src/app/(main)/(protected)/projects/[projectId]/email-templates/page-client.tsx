"use client";

import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { Reader } from "@stackframe/stack-emails/dist/editor/email-builder/index";
import { EMAIL_TEMPLATES_METADATA, convertEmailSubjectVariables, convertEmailTemplateMetadataExampleValues, convertEmailTemplateVariables, validateEmailTemplateContent } from "@stackframe/stack-emails/dist/utils";
import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { ActionCell, ActionDialog, Alert, AlertDescription, AlertTitle, Button, Card, Typography } from "@stackframe/stack-ui";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const emailTemplates = stackAdminApp.useEmailTemplates();
  const router = useRouter();
  const [resetTemplateType, setResetTemplateType] = useState<EmailTemplateType>("email_verification");
  const [resetTemplateDialogOpen, setResetTemplateDialogOpen] = useState(false);
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<EmailTemplateType|null>(null);

  return (
    <PageLayout title="Emails" description="Configure email settings for your project">
      <SettingCard title="Email Templates" description="Customize the emails sent">
        {emailConfig?.type === 'shared' && <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
          </AlertDescription>
        </Alert>}
        {emailTemplates.map((template) => (
          <Card key={template.type} className="p-4 flex justify-between flex-col sm:flex-row gap-4">
            <div className="flex flex-col gap-2">
              <div>
                <Typography className="font-medium">
                  {EMAIL_TEMPLATES_METADATA[template.type].label}
                </Typography>
                <Typography type='label' variant='secondary'>
                  Subject: <SubjectPreview subject={template.subject} type={template.type} />
                </Typography>
              </div>
              <div className="flex-grow flex justify-start items-end gap-2">
                <Button variant='secondary' onClick={() => {
                  if (emailConfig?.type === 'shared') {
                    setSharedSmtpWarningDialogOpen(template.type);
                  } else {
                    router.push(`email-templates/${template.type}`);
                  }
                }}>Edit Template</Button>
                {!template.isDefault && <ActionCell
                  items={[{
                    item: 'Reset to Default',
                    danger: true,
                    onClick: () => {
                      setResetTemplateType(template.type);
                      setResetTemplateDialogOpen(true);
                    }
                  }]}
                />}
              </div>
            </div>
            <EmailPreview content={template.content} type={template.type} />
          </Card>
        ))}
      </SettingCard>

      <ActionDialog
        open={sharedSmtpWarningDialogOpen !== null}
        onClose={() => setSharedSmtpWarningDialogOpen(null)}
        title="Shared Email Server"
        okButton={{ label: "Edit Templates Anyway", onClick: async () => {
          router.push(`email-templates/${sharedSmtpWarningDialogOpen}`);
        } }}
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
      <ResetEmailTemplateDialog
        open={resetTemplateDialogOpen}
        onClose={() => setResetTemplateDialogOpen(false)}
        templateType={resetTemplateType}
      />
    </PageLayout>
  );
}

function EmailPreview(props: { content: any, type: EmailTemplateType }) {
  const project = useAdminApp().useProject();
  const [valid, document] = useMemo(() => {
    const valid = validateEmailTemplateContent(props.content);
    if (!valid) return [false, null];

    const metadata = convertEmailTemplateMetadataExampleValues(EMAIL_TEMPLATES_METADATA[props.type], project.displayName);
    const document = convertEmailTemplateVariables(props.content, metadata.variables);
    return [true, document];
  }, [props.content, props.type, project]);

  let reader;
  if (valid && document) {
    reader = (
      <div className="scale-50 w-[400px] origin-top-left">
        <Reader document={document} rootBlockId='root' />
      </div>
    );
  } else {
    reader = <div className="flex items-center justify-center h-full text-red-500">Invalid template</div>;
  }

  return (
    <div className="max-h-[150px] min-h-[150px] max-w-[200px] sm:min-w-[200px] overflow-hidden rounded border" inert>
      <div className="absolute inset-0 bg-transparent z-10"/>
      {reader}
    </div>
  );
}

function SubjectPreview(props: { subject: string, type: EmailTemplateType }) {
  const project = useAdminApp().useProject();
  const subject = useMemo(() => {
    const metadata = convertEmailTemplateMetadataExampleValues(EMAIL_TEMPLATES_METADATA[props.type], project.displayName);
    return convertEmailSubjectVariables(props.subject, metadata.variables);
  }, [props.subject, props.type, project]);
  return subject;
}


function ResetEmailTemplateDialog(props: {
  open?: boolean,
  onClose?: () => void,
  templateType: EmailTemplateType,
}) {
  const stackAdminApp = useAdminApp();
  return <ActionDialog
    danger
    open={props.open}
    onClose={props.onClose}
    title="Reset Email Template"
    okButton={{
      label: "Reset",
      onClick: async () => { await stackAdminApp.resetEmailTemplate(props.templateType); }
    }}
    confirmText="I understand this cannot be undone"
  >
    Are you sure you want to reset the email template to the default? You will lose all the changes you have made.
  </ActionDialog>;
}
