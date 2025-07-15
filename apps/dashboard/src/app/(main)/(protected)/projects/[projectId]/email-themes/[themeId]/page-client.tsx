"use client";

import ThemePreview, { previewEmailHtml } from "@/components/theme-preview";
import {
  createChatAdapter,
  createHistoryAdapter
} from "@/components/vibe-coding/chat-adapters";
import { CreateEmailThemeUI } from "@/components/vibe-coding/theme-tool-components";
import VibeAssistantChat from "@/components/vibe-coding/vibe-assistant-chat";
import VibeCodeEditor from "@/components/vibe-coding/vibe-code-editor";
import VibeCodeEditorLayout from "@/components/vibe-coding/vibe-code-editor-layout";
import VibePreviewPanel from "@/components/vibe-coding/vibe-preview-panel";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { toast } from "@stackframe/stack-ui";
import debounce from "lodash/debounce";
import { useMemo, useState } from "react";
import { useAdminApp } from "../../use-admin-app";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const [renderedHtml, setRenderedHtml] = useState<string>();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);
  const [loading, setLoading] = useState(false);

  const debouncedUpdateCode = useMemo(
    () => debounce(
      async (value: string) => {
        setLoading(true);
        try {
          const { rendered_html } = await stackAdminApp.updateEmailTheme(themeId, value, previewEmailHtml);
          setRenderedHtml(rendered_html);
        } catch (error) {
          if (KnownErrors.EmailRenderingError.isInstance(error)) {
            toast({
              title: "Failed to render email",
              description: error.message,
              variant: "destructive",
            });
            return;
          }
        } finally {
          setLoading(false);
        }
      },
      500,
    ),
    [stackAdminApp, themeId],
  );

  const handleCodeChange = (value: string) => {
    setCurrentCode(value);
    runAsynchronously(debouncedUpdateCode(value));
  };

  const handleThemeUpdate = (code: string) => {
    setCurrentCode(code);
    stackAdminApp.getEmailThemePreview(themeId, previewEmailHtml)
      .then(setRenderedHtml)
      .catch(() => toast({
        title: "Failed to render email",
        description: "There was an error rendering email preview",
        variant: "destructive",
      }));
  };

  return (
    <VibeCodeEditorLayout
      previewComponent={
        <VibePreviewPanel>
          <ThemePreview themeId={themeId} renderedHtmlOverride={renderedHtml} />
        </VibePreviewPanel>
      }
      editorComponent={
        <VibeCodeEditor
          code={currentCode}
          onCodeChange={handleCodeChange}
          isLoading={loading}
        />
      }
      chatComponent={
        <VibeAssistantChat
          chatAdapter={createChatAdapter(stackAdminApp, themeId, currentCode, handleThemeUpdate)}
          historyAdapter={createHistoryAdapter(stackAdminApp, themeId)}
          toolComponents={[CreateEmailThemeUI]}
        />
      }
    />
  );
}


