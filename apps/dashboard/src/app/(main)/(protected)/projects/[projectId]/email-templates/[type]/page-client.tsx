'use client';
import ErrorPage from "@/components/error-page";
import { confirmAlertMessage, useRouter, useRouterConfirm } from "@/components/router";
import { TEditorConfiguration } from "@stackframe/stack-emails/dist/editor/documents/editor/core";
import EmailEditor from "@stackframe/stack-emails/dist/editor/editor";
import { EMAIL_TEMPLATES_METADATA, validateEmailTemplateContent } from "@stackframe/stack-emails/dist/utils";
import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { useToast } from "@stackframe/stack-ui";
import { usePathname } from "next/navigation";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient(props: { templateType: EmailTemplateType }) {
  const app = useAdminApp();
  const emailTemplates = app.useEmailTemplates();
  const template = emailTemplates.find((template) => template.type === props.templateType);
  const router = useRouter();
  const pathname = usePathname();
  const { setNeedConfirm } = useRouterConfirm();
  const { toast } = useToast();
  const project = app.useProject();

  if (!template) {
    // this should not happen, the outer server component should handle this
    router.push("/404");
    return null;
  }

  if (!validateEmailTemplateContent(template.content)) {
    return <ErrorPage
      title="Invalid Template"
      description="The email template content is invalid"
      redirectUrl={`/projects/${app.projectId}`}
      redirectText="Go to dashboard"
    />;
  }

  const onSave = async (document: TEditorConfiguration, subject: string) => {
    await app.updateEmailTemplate(props.templateType, {
      content: document,
      subject,
    });
    toast({ title: 'Email template saved', variant: 'success' });
  };

  const onCancel = () => {
    router.push(`/projects/${app.projectId}/emails`);
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <EmailEditor
        resetSignal={pathname}
        document={template.content}
        subject={template.subject}
        metadata={EMAIL_TEMPLATES_METADATA[props.templateType]}
        onSave={onSave}
        onCancel={onCancel}
        confirmAlertMessage={confirmAlertMessage}
        setNeedConfirm={setNeedConfirm}
        projectDisplayName={project.displayName}
      />
    </div>
  );
}
