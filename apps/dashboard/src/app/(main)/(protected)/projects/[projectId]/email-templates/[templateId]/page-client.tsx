"use client";

import EmailPreview from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouterConfirm } from "@/components/router";
import {
  AssistantChat,
  CodeEditor,
  createChatAdapter,
  createHistoryAdapter,
  EmailTemplateUI,
  VibeCodeLayout
} from "@/components/vibe-coding";
import { ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Button, toast } from "@/components/ui";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useEmailTemplates();
  const { setNeedConfirm } = useRouterConfirm();
  const template = templates.find((t) => t.id === props.templateId);
  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(template?.themeId);


  useEffect(() => {
    if (!template) return;
    if (template.tsxSource === currentCode && template.themeId === selectedThemeId) return;
    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, template, currentCode, selectedThemeId]);

  const handleCodeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleSaveTemplate = async () => {
    try {
      await stackAdminApp.updateEmailTemplate(props.templateId, currentCode, selectedThemeId === undefined ? null : selectedThemeId);
      toast({ title: "Template saved", variant: "success" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError || error instanceof KnownErrors.RequiresCustomEmailServer) {
        toast({ title: "Failed to save template", variant: "destructive", description: error.message });
        return;
      }
      throw error;
    }
  };


  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'phone'>('desktop');

  if (!template) {
    return (
      <AppEnabledGuard appId="emails">
        <PageLayout title="Email Template Not Found">
          <p>The requested email template could not be found.</p>
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  return (
    <AppEnabledGuard appId="emails">
      <VibeCodeLayout
        viewport={viewport}
        onViewportChange={setViewport}
        onSave={handleSaveTemplate}
        isDirty={currentCode !== template.tsxSource || selectedThemeId !== template.themeId}
        previewComponent={
          <EmailPreview 
            themeId={selectedThemeId} 
            templateTsxSource={currentCode} 
            viewport={viewport === 'desktop' ? undefined : (viewport === 'tablet' ? { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' } : { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' })}
          />
        }
        editorComponent={
          <CodeEditor
            code={currentCode}
            onCodeChange={setCurrentCode}
            action={
              <div className="flex gap-2">
                <EmailThemeSelector
                  selectedThemeId={selectedThemeId}
                  onThemeChange={setSelectedThemeId}
                  className="w-48"
                />
              </div>
            }
          />
        }
        chatComponent={
          <AssistantChat
            chatAdapter={createChatAdapter(stackAdminApp, template.id, "email-template", handleCodeUpdate)}
            historyAdapter={createHistoryAdapter(stackAdminApp, template.id)}
            toolComponents={<EmailTemplateUI setCurrentCode={setCurrentCode} />}
          />
        }
      />
    </AppEnabledGuard>
  );
}
