"use client";

import ThemePreview, { previewTemplateSource } from "@/components/theme-preview";
import { AssistantChat, CodeEditor, PreviewPanel, VibeCodeLayout } from "@/components/vibe-coding";
import {
  createChatAdapter,
  createHistoryAdapter,
  ToolCallContent
} from "@/components/vibe-coding/chat-adapters";
import { CreateEmailThemeUI } from "@/components/vibe-coding/theme-tool-components";
import { useState } from "react";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);

  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  return (
    <VibeCodeLayout
      previewComponent={
        <PreviewPanel>
          <ThemePreview themeTsxSource={currentCode} templateTsxSource={previewTemplateSource} />
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
          chatAdapter={createChatAdapter(stackAdminApp, themeId, "email-theme", handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, themeId)}
          toolComponents={[CreateEmailThemeUI]}
        />
      }
    />
  );
}


