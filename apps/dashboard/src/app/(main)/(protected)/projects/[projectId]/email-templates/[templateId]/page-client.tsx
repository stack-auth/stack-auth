"use client";

import EmailPreview from "@/components/email-preview";
import { useRouterConfirm } from "@/components/router";
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
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useEmailTemplates();
  const { setNeedConfirm } = useRouterConfirm();
  const template = templates.find((t) => t.id === props.templateId);
  const [currentCode, setCurrentCode] = useState(template?.tsxSource ?? "");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(template?.themeId);


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


  if (!template) {
    return <PageLayout
      title="Email Template Not Found"
    />;
  }

  return (
    <VibeCodeLayout
      previewComponent={
        <div className="p-4 w-full h-full">
          <EmailPreview themeId={selectedThemeId === undefined ? null : selectedThemeId} templateTsxSource={currentCode} />
        </div>
      }
      editorComponent={
        <CodeEditor
          code={currentCode}
          onCodeChange={setCurrentCode}
          action={
            <div className="flex gap-2">
              <ThemeSelector
                selectedThemeId={selectedThemeId}
                onThemeChange={setSelectedThemeId}
                className="w-48"
              />
              <Button
                disabled={currentCode === template.tsxSource && selectedThemeId === template.themeId}
                onClick={handleSaveTemplate}
              >
                Save
              </Button>
            </div>
          }
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
  );
}

type ThemeSelectorProps = {
  selectedThemeId: string | undefined | false,
  onThemeChange: (themeId: string | undefined | false) => void,
  className?: string,
}

function themeIdToSelectString(themeId: string | undefined | false): string {
  return JSON.stringify(themeId ?? null);
}
function selectStringToThemeId(value: string): string | undefined | false {
  return JSON.parse(value) ?? undefined;
}

function ThemeSelector({ selectedThemeId, onThemeChange, className }: ThemeSelectorProps) {
  const stackAdminApp = useAdminApp();
  const themes = stackAdminApp.useEmailThemes();
  return (
    <Select
      value={themeIdToSelectString(selectedThemeId)}
      onValueChange={(value) => onThemeChange(selectStringToThemeId(value))}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="No theme" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={"false"}>No theme</SelectItem>
        <SelectItem value={"null"}>Project theme</SelectItem>
        {themes.map((theme) => (
          <SelectItem key={theme.id} value={JSON.stringify(theme.id)}>
            {theme.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
