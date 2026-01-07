"use client";

import EmailPreview from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouterConfirm } from "@/components/router";
import { Skeleton, toast } from "@/components/ui";
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
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useEmailTemplates();
  const { setNeedConfirm } = useRouterConfirm();
  const templateFromHook = templates.find((t) => t.id === props.templateId);

  // State for loading and template data
  const [isLoading, setIsLoading] = useState(!templateFromHook);
  const [fetchedTemplate, setFetchedTemplate] = useState<{ id: string, displayName: string, themeId?: string, tsxSource: string } | null>(null);

  // Use either the template from the hook or the manually fetched one
  const template = templateFromHook ?? fetchedTemplate;

  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(template?.themeId);

  // If template not found in hook data, try to fetch it directly
  useEffect(() => {
    // Skip if we already have the template
    if (templateFromHook) {
      setIsLoading(false);
      return;
    }
    // Skip if we already fetched it
    if (fetchedTemplate) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchTemplate = async () => {
      const allTemplates = await stackAdminApp.listEmailTemplates();

      if (cancelled) return;

      const found = allTemplates.find((t) => t.id === props.templateId);

      if (found) {
        setFetchedTemplate(found);
        setCurrentCode(found.tsxSource);
        setSelectedThemeId(found.themeId);
      }

      setIsLoading(false);
    };

    runAsynchronously(fetchTemplate);

    return () => {
      cancelled = true;
    };
  }, [templateFromHook, fetchedTemplate, stackAdminApp, props.templateId]);

  // When the template appears in the hook (e.g., after cache updates), sync state
  useEffect(() => {
    if (templateFromHook && !currentCode) {
      setCurrentCode(templateFromHook.tsxSource);
      setSelectedThemeId(templateFromHook.themeId);
    }
  }, [templateFromHook, currentCode]);

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
    // Show loading state while waiting for the template (either from hook or direct fetch)
    if (isLoading) {
      return (
        <AppEnabledGuard appId="emails">
          <PageLayout title="Loading Template...">
            <div className="flex flex-col gap-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          </PageLayout>
        </AppEnabledGuard>
      );
    }
    return (
      <AppEnabledGuard appId="emails">
        <PageLayout title="Email Template Not Found">
          <p>The requested email template could not be found.</p>
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  const previewActions = null;

  return (
    <AppEnabledGuard appId="emails">
      <VibeCodeLayout
        viewport={viewport}
        onViewportChange={setViewport}
        onSave={handleSaveTemplate}
        isDirty={currentCode !== template.tsxSource || selectedThemeId !== template.themeId}
        previewActions={previewActions}
        editorTitle="Template Source Code"
        headerAction={
          <EmailThemeSelector
            selectedThemeId={selectedThemeId}
            onThemeChange={setSelectedThemeId}
          />
        }
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
