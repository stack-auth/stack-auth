"use client";

import { useRouterConfirm } from "@/components/router";
import ThemePreview from "@/components/theme-preview";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { AssistantChat, CodeEditor, EmailThemeUI, PreviewPanel, VibeCodeLayout } from "@/components/vibe-coding";
import {
  createChatAdapter,
  createHistoryAdapter,
  ToolCallContent
} from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Button, toast } from "@stackframe/stack-ui";
import React, { useEffect, useState } from "react";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const { setNeedConfirm } = useRouterConfirm();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);

  useEffect(() => {
    if (theme.tsxSource === currentCode) return;
    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, theme, currentCode]);

  const handleThemeUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleSaveTheme = async () => {
    try {
      await stackAdminApp.updateEmailTheme(themeId, currentCode);
      toast({ title: "Theme saved", variant: "success" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        toast({ title: "Failed to save theme", variant: "destructive", description: error.message });
        return;
      }
      throw error;
    }
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
          action={
            <Button
              disabled={currentCode === theme.tsxSource}
              onClick={handleSaveTheme}
            >
              Save
            </Button>
          }
        />
      }
      chatComponent={
        <AssistantChat
          chatAdapter={createChatAdapter(stackAdminApp, themeId, "email-theme", handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, themeId)}
          toolComponents={<EmailThemeUI setCurrentCode={setCurrentCode} />}
        />
      }
    />
  );
}


