"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider, makeAssistantToolUI, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { Card, TooltipProvider } from "@stackframe/stack-ui";
import { CheckCircle, XCircle } from "lucide-react";

export default function DevServerChat({ repoId }: { repoId: string }) {
  const adminApp = useAdminApp();

  const chatAdapter: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      try {
        const formattedMessages = messages.map((msg) => ({
          role: msg.role,
          content: msg.content.map((part) => {
            if (part.type === 'text') {
              return part.text;
            }
            return '';
          }).join(''),
        }));

        const response = await adminApp.sendDevServerChatMessage(repoId, formattedMessages, abortSignal);
        return {
          content: response.content,
        };
      } catch (error) {
        if (abortSignal.aborted) {
          return {};
        }
        throw error;
      }
    },
  };

  const CreateEmailThemeUI = makeAssistantToolUI<{ content: string }, { success: boolean }>({
    toolName: "createEmailTheme",
    render: ({ result }) => {
      return (
        <Card className="flex items-center gap-2 p-4">
          {result?.success ? <CheckCircle className="size-4 text-green-500" /> : <XCircle className="size-4 text-red-500" />}
          <span className="text-sm">Created email theme</span>
        </Card>
      );
    }
  });

  const runtime = useLocalRuntime(chatAdapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CreateEmailThemeUI />
      <TooltipProvider>
        <Thread />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}


