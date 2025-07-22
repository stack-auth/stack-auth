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
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { bundleJavaScript } from "@stackframe/stack-shared/dist/utils/esbuild";


export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const templates = stackAdminApp.useNewEmailTemplates();
  const template = templates.find((t) => t.id === props.templateId);
  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");


  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
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
