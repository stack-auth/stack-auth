"use client";

import EmailPreview, { type OnWysiwygEditCommit } from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouterConfirm } from "@/components/router";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "@/components/ui";
import {
  AssistantChat,
  CodeEditor,
  createChatAdapter,
  createHistoryAdapter,
  EmailTemplateUI,
  VibeCodeLayout,
  type ViewportMode,
  type WysiwygDebugInfo,
} from "@/components/vibe-coding";
import { ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const [fetchedTemplate, setFetchedTemplate] = useState<{ id: string, displayName: string, themeId?: string, tsxSource: string } | null>(null);
  const [saveAlert, setSaveAlert] = useState<{
    variant: "destructive" | "success",
    title: string,
    description?: string,
  } | null>(null);

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
      try {
        const allTemplates = await stackAdminApp.listEmailTemplates();

        if (cancelled) return;

        const found = allTemplates.find((t) => t.id === props.templateId);

        if (found) {
          setFetchedTemplate(found);
          setCurrentCode(found.tsxSource);
          setSelectedThemeId(found.themeId);
        }
      } catch (error) {
        if (cancelled) return;
        const fetchError = error instanceof Error ? error : new Error(String(error));
        setFetchError(fetchError);
        throw fetchError;
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    runAsynchronously(fetchTemplate);

    return () => {
      cancelled = true;
    };
  }, [templateFromHook, fetchedTemplate, stackAdminApp, props.templateId]);

  const hasSyncedTemplateFromHook = useRef(false);

  // When the template appears in the hook (e.g., after cache updates), sync state
  useEffect(() => {
    if (!templateFromHook || hasSyncedTemplateFromHook.current) return;
    if (!currentCode) {
      setCurrentCode(templateFromHook.tsxSource);
      setSelectedThemeId(templateFromHook.themeId);
    }
    hasSyncedTemplateFromHook.current = true;
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
    setSaveAlert(null);
    try {
      await stackAdminApp.updateEmailTemplate(props.templateId, currentCode, selectedThemeId === undefined ? null : selectedThemeId);
      setSaveAlert({ variant: "success", title: "Template saved" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError || error instanceof KnownErrors.RequiresCustomEmailServer) {
        setSaveAlert({
          variant: "destructive",
          title: "Failed to save template",
          description: getErrorMessage(error),
        });
        return;
      }
      throw error;
    }
  };

  const handleUndo = () => {
    if (template) {
      setCurrentCode(template.tsxSource);
      setSelectedThemeId(template.themeId);
    }
  };

  const [viewport, setViewport] = useState<ViewportMode>('edit');
  const [wysiwygDebugInfo, setWysiwygDebugInfo] = useState<WysiwygDebugInfo | undefined>(undefined);

  // Handle WYSIWYG edit commits - calls the AI endpoint to update source code
  const handleWysiwygEditCommit: OnWysiwygEditCommit = useCallback(async (data) => {
    const result = await stackAdminApp.applyWysiwygEdit({
      sourceType: 'template',
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
    // Show error state with retry option
    if (fetchError) {
      return (
        <AppEnabledGuard appId="emails">
          <PageLayout title="Failed to Load Template">
            <div className="flex flex-col gap-4">
              <p className="text-destructive">Failed to load template: {fetchError.message}</p>
              <Button
                onClick={() => {
                  setFetchError(null);
                  setIsLoading(true);
                  const fetchTemplate = async () => {
                    try {
                      const allTemplates = await stackAdminApp.listEmailTemplates();
                      const found = allTemplates.find((t) => t.id === props.templateId);
                      if (found) {
                        setFetchedTemplate(found);
                        setCurrentCode(found.tsxSource);
                        setSelectedThemeId(found.themeId);
                      }
                    } catch (error) {
                      setFetchError(error instanceof Error ? error : new Error(String(error)));
                    } finally {
                      setIsLoading(false);
                    }
                  };
                  runAsynchronously(fetchTemplate);
                }}
              >
                Retry
              </Button>
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
  const isDirty = currentCode !== template.tsxSource || selectedThemeId !== template.themeId;

  return (
    <AppEnabledGuard appId="emails">
      <div data-full-bleed className="flex h-full flex-col">
        {saveAlert && (
          <div className="px-3 pt-3 md:px-6 md:pt-4">
            <Alert variant={saveAlert.variant}>
              <AlertTitle>{saveAlert.title}</AlertTitle>
              {saveAlert.description && (
                <AlertDescription>{saveAlert.description}</AlertDescription>
              )}
            </Alert>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <VibeCodeLayout
            viewport={viewport}
            onViewportChange={setViewport}
            onSave={handleSaveTemplate}
            useOffWhiteLightChrome
            saveLabel="Save template"
            onUndo={handleUndo}
            isDirty={isDirty}
            previewActions={previewActions}
            editorTitle="Template Source Code"
            editModeEnabled
            wysiwygDebugInfo={wysiwygDebugInfo}
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
                editMode={viewport === 'edit'}
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
                chatAdapter={createChatAdapter(stackAdminApp, template.id, "email-template", handleCodeUpdate)}
                historyAdapter={createHistoryAdapter(stackAdminApp, template.id)}
                toolComponents={<EmailTemplateUI setCurrentCode={setCurrentCode} />}
                useOffWhiteLightMode
              />
            }
          />
        </div>
      </div>
    </AppEnabledGuard>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof KnownErrors.EmailRenderingError) {
    return error.message;
  }
  if (error instanceof KnownErrors.RequiresCustomEmailServer) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
