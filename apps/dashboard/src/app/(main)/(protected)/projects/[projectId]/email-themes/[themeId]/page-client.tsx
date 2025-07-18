"use client";

import ThemePreview, { previewEmailHtml } from "@/components/theme-preview";
import { AssistantChat, CodeEditor, PreviewPanel, VibeCodeLayout } from "@/components/vibe-coding";
import {
  createChatAdapter,
  createHistoryAdapter,
  ToolCallContent
} from "@/components/vibe-coding/chat-adapters";
import { CreateEmailThemeUI } from "@/components/vibe-coding/theme-tool-components";
import { useCallback, useState } from "react";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const [renderedHtml, setRenderedHtml] = useState<string>();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);

  const handleDebouncedCodeChange = useCallback(async (value: string) => {
    const { rendered_html } = await stackAdminApp.updateEmailTheme(themeId, value, previewEmailHtml);
    setRenderedHtml(rendered_html);
  }, [stackAdminApp, themeId]);

  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
    if (toolCall.result.html) {
      setRenderedHtml(toolCall.result.html);
    }
  };

  return (
    <VibeCodeLayout
      previewComponent={
        <PreviewPanel>
          <ThemePreview themeId={themeId} renderedHtmlOverride={renderedHtml} />
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
          chatAdapter={createChatAdapter(stackAdminApp, themeId, "email-theme", handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, themeId)}
          toolComponents={[CreateEmailThemeUI]}
        />
      }
    />
  );
}


