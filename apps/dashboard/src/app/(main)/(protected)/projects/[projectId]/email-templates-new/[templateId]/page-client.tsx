"use client";

import { useRouterConfirm } from "@/components/router";
import ThemePreview from "@/components/theme-preview";
import {
  AssistantChat,
  CodeEditor,
  createChatAdapter,
  createHistoryAdapter,
  EmailTemplateUI,
  PreviewPanel,
  VibeCodeLayout,
} from "@/components/vibe-coding";
import { ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Button, toast } from "@stackframe/stack-ui";
import React, { useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const templates = stackAdminApp.useNewEmailTemplates();
  const { setNeedConfirm } = useRouterConfirm();
  const template = templates.find((t) => t.id === props.templateId);
  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");


  useEffect(() => {
    if (!template || template.tsxSource === currentCode) return;
    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, template, currentCode]);

  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleSaveTemplate = async () => {
    try {
      await stackAdminApp.updateNewEmailTemplate(props.templateId, currentCode);
      toast({ title: "Template saved", variant: "success" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        toast({ title: "Failed to save template", variant: "destructive", description: error.message });
        return;
      }
      throw error;
    }
  };


  if (!template) {
    return <PageLayout
      title="Email Template Not Found"
    />;
  }

  return (
    <VibeCodeLayout
      previewComponent={
        <PreviewPanel>
          <ThemePreview
            themeId={project.config.emailTheme}
            templateTsxSource={currentCode}
          />
        </PreviewPanel>
      }
      editorComponent={
        <CodeEditor
          code={currentCode}
          onCodeChange={setCurrentCode}
          action={
            <Button
              disabled={currentCode === template.tsxSource}
              onClick={handleSaveTemplate}
            >
              Save
            </Button>
          }
        />
      }
      chatComponent={
        <AssistantChat
          chatAdapter={createChatAdapter(stackAdminApp, template.id, "email-template", handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, template.id)}
          toolComponents={<EmailTemplateUI setCurrentCode={setCurrentCode} />}
        />
      }
    />
  );
}
