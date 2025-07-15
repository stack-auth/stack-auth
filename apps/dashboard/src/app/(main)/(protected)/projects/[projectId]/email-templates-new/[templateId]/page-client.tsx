"use client";

import {
  VibeAssistantChat,
  VibeCodeEditor,
  VibeCodeEditorLayout,
  VibePreviewPanel,
  createChatAdapter,
  createHistoryAdapter,
} from "@/components/vibe-coding";
import { BrowserFrame, Typography } from "@stackframe/stack-ui";
import { useAdminApp } from "../../use-admin-app";
import NotFound from "@/app/not-found";

export default function PageClient(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useNewEmailTemplates();
  const template = templates.find((t) => t.id === props.templateId);

  if (!template) {
    return <NotFound />;
  }

  return (
    <VibeCodeEditorLayout
      previewComponent={
        <VibePreviewPanel>
          <BrowserFrame transparentBackground className="flex flex-col grow">
            <div className="p-4 h-full flex items-center justify-center">
              <div className="text-center">
                <Typography type="h3" className="mb-2">Template Preview</Typography>
                <Typography className="text-gray-600 mb-4">
                  Preview functionality will be implemented once the template content API is available.
                </Typography>
                <div className="bg-gray-100 p-4 rounded">
                  <Typography type="p" className="font-medium">Template Info:</Typography>
                  <Typography type="p" className="text-sm text-gray-600">
                    {template.displayName}
                  </Typography>
                  <Typography type="p" className="text-sm text-gray-600">
                    Subject: {template.subject}
                  </Typography>
                </div>
              </div>
            </div>
          </BrowserFrame>
        </VibePreviewPanel>
      }
      editorComponent={
        <VibeCodeEditor
          code={template.tsxSource}
          onCodeChange={(code) => {
            // TODO: Implement code change handling
          }}
          isLoading={false}
        />
      }
      chatComponent={
        <VibeAssistantChat
          chatAdapter={
            createChatAdapter(
              stackAdminApp,
              template.id,
              template.tsxSource,
              (toolCallContent: string) => {
                // TODO: Implement template update when API becomes available
                console.log("Tool call content:", toolCallContent);
              }
            )
          }
          historyAdapter={createHistoryAdapter(stackAdminApp, template.id)}
        />
      }
    />
  );
}
