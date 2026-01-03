"use client";

import EmailPreview from "@/components/email-preview";
import { useRouterConfirm } from "@/components/router";
import { AssistantChat, CodeEditor, EmailThemeUI, VibeCodeLayout } from "@/components/vibe-coding";
import {
  ToolCallContent,
  createChatAdapter,
  createHistoryAdapter
} from "@/components/vibe-coding/chat-adapters";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, toast, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { useEffect, useState, useCallback } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";
import { Copy, DownloadSimple, ArrowCounterClockwise, Check, WarningCircle } from "@phosphor-icons/react";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const { setNeedConfirm } = useRouterConfirm();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'phone'>('desktop');

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

  const previewActions = null;

  return (
    <AppEnabledGuard appId="emails">
      <VibeCodeLayout
        viewport={viewport}
        onViewportChange={setViewport}
        onSave={handleSaveTheme}
        isDirty={currentCode !== theme.tsxSource}
        previewActions={previewActions}
        editorTitle="Theme Source Code"
        previewComponent={
          <EmailPreview
            themeTsxSource={currentCode}
            templateTsxSource={previewTemplateSource}
            viewport={viewport === 'desktop' ? undefined : (viewport === 'tablet' ? { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' } : { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' })}
          />
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
            toolComponents={<EmailThemeUI setCurrentCode={setCurrentCode} />}
          />
        }
      />
    </AppEnabledGuard>
  );
}
