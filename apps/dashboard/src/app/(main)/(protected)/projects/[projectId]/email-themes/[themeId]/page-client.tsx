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
  const [isCopying, setIsCopying] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

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

  const handleCopyHtml = useCallback(async () => {
    try {
      setIsCopying(true);
      const html = await stackAdminApp.getEmailPreview({
        themeTsxSource: currentCode,
        templateTsxSource: previewTemplateSource,
      });
      await navigator.clipboard.writeText(html);
      toast({ title: "HTML copied to clipboard", variant: "success" });
      setTimeout(() => setIsCopying(false), 2000);
    } catch (error) {
      setIsCopying(false);
      toast({ title: "Failed to copy HTML", variant: "destructive" });
    }
  }, [stackAdminApp, currentCode]);

  const handleDownloadHtml = useCallback(async () => {
    try {
      const html = await stackAdminApp.getEmailPreview({
        themeTsxSource: currentCode,
        templateTsxSource: previewTemplateSource,
      });
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${theme.displayName || 'email-theme'}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Failed to download HTML", variant: "destructive" });
    }
  }, [stackAdminApp, currentCode, theme]);

  const handleReset = useCallback(() => {
    setShowResetDialog(true);
  }, []);

  const confirmReset = useCallback(async () => {
    setCurrentCode(theme.tsxSource);
    setShowResetDialog(false);
  }, [theme]);

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

      {/* Reset Confirmation Dialog */}
      <ActionDialog
        open={showResetDialog}
        onClose={() => setShowResetDialog(false)}
        title="Reset Theme?"
        okButton={{
          label: "Reset",
          onClick: confirmReset,
          props: {
            variant: "destructive"
          }
        }}
        cancelButton={{ label: "Cancel" }}
      >
        <Alert className="bg-orange-500/5 border-orange-500/20">
          <WarningCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <AlertTitle className="text-orange-600 dark:text-orange-400 font-semibold">
            Unsaved Changes Will Be Lost
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Are you sure you want to reset the theme to its original state? All unsaved changes will be permanently lost.
          </AlertDescription>
        </Alert>
      </ActionDialog>
    </AppEnabledGuard>
  );
}
