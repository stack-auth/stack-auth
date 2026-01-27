"use client";

import EmailPreview, { type OnWysiwygEditCommit } from "@/components/email-preview";
import { useRouterConfirm } from "@/components/router";
import { toast } from "@/components/ui";
import { AssistantChat, CodeEditor, EmailThemeUI, VibeCodeLayout, type ViewportMode, type WysiwygDebugInfo } from "@/components/vibe-coding";
import {
  createChatAdapter,
  createHistoryAdapter,
  ToolCallContent
} from "@/components/vibe-coding/chat-adapters";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { useCallback, useEffect, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const { setNeedConfirm } = useRouterConfirm();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);
  const [viewport, setViewport] = useState<ViewportMode>('edit');
  const [wysiwygDebugInfo, setWysiwygDebugInfo] = useState<WysiwygDebugInfo | undefined>(undefined);

  // Handle WYSIWYG edit commits - calls the AI endpoint to update source code
  const handleWysiwygEditCommit: OnWysiwygEditCommit = useCallback(async (data) => {
    const result = await stackAdminApp.applyWysiwygEdit({
      sourceType: 'theme',
      sourceCode: currentCode,
      oldText: data.oldText,
      newText: data.newText,
      metadata: data.metadata,
      domPath: data.domPath,
      htmlContext: data.htmlContext,
    });
    setCurrentCode(result.updatedSource);
    return result.updatedSource;
  }, [stackAdminApp, currentCode]);

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

  const handleUndo = () => {
    setCurrentCode(theme.tsxSource);
  };

  const previewActions = null;
  const isDirty = currentCode !== theme.tsxSource;

  return (
    <AppEnabledGuard appId="emails">
      <VibeCodeLayout
        viewport={viewport}
        onViewportChange={setViewport}
        onSave={handleSaveTheme}
        saveLabel="Save theme"
        onUndo={handleUndo}
        isDirty={isDirty}
        previewActions={previewActions}
        editorTitle="Theme Source Code"
        editModeEnabled
        wysiwygDebugInfo={wysiwygDebugInfo}
        previewComponent={
          <EmailPreview
            themeTsxSource={currentCode}
            templateTsxSource={previewTemplateSource}
            editMode={viewport === 'edit'}
            editableSource="theme"
            viewport={viewport === 'desktop' || viewport === 'edit' ? undefined : (viewport === 'tablet' ? { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' } : { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' })}
            onDebugInfoChange={setWysiwygDebugInfo}
            onWysiwygEditCommit={handleWysiwygEditCommit}
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
