"use client";

import ThemePreview from "@/components/theme-preview";
import {
  AssistantChat,
  CodeEditor,
  CreateEmailTemplateUI,
  PreviewPanel,
  VibeCodeLayout,
  createChatAdapter,
  createHistoryAdapter,
} from "@/components/vibe-coding";
import { useCallback, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { ToolCallContent } from "@/components/vibe-coding/chat-adapters";

export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const templates = stackAdminApp.useNewEmailTemplates();
  const template = templates.find((t) => t.id === props.templateId);
  const [renderedHtml, setRenderedHtml] = useState<string>();
  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");

  const handleDebouncedCodeChange = useCallback(async (value: string) => {
    const { renderedHtml } = await stackAdminApp.updateNewEmailTemplate(props.templateId, value);
    setRenderedHtml(renderedHtml);
  }, [stackAdminApp, props.templateId]);

  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
    if (toolCall.result.html) {
      setRenderedHtml(toolCall.result.html);
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
            templateId={template.id}
            renderedHtmlOverride={renderedHtml}
          />
        </PreviewPanel>
      }
      editorComponent={
        <CodeEditor
          code={currentCode}
          onCodeChange={setCurrentCode}
          onDebouncedCodeChange={handleDebouncedCodeChange}
        />
      }
      chatComponent={
        <AssistantChat
          chatAdapter={createChatAdapter(stackAdminApp, template.id, "email-template", handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, template.id)}
          toolComponents={[CreateEmailTemplateUI]}
        />
      }
    />
  );
}
