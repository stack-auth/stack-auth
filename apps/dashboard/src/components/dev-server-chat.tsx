"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Thread } from "@/components/assistant-ui/thread";
import { TooltipProvider } from "@stackframe/stack-ui";
import { AssistantRuntimeProvider, useLocalRuntime, tool, makeAssistantTool, type ChatModelAdapter, makeAssistantToolUI } from "@assistant-ui/react";
import { CheckIcon, XIcon } from "lucide-react";



export default function DevServerChat({ repoId }: { repoId: string }) {
  const adminApp = useAdminApp();

  const chatAdapter: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      return {
        content: [{ type: "text", text: "asdf" }, { type: "tool-call", toolName: "createEmailTheme", result: { success: true } }],
      };
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
          content: [{ type: "text", text: response.text }],
        };
      } catch (error) {
        if (abortSignal?.aborted) {
          return {};
        }
        throw error;
      }
    },
  }

  const CreateEmailThemeUI = makeAssistantToolUI<{ content: string }, { success: boolean }>({
    toolName: "createEmailTheme",
    render: ({ args, result }) => {
      return (
        <div className="flex items-center gap-2">
          {result?.success ? <CheckIcon className="size-4 text-green-500" /> : <XIcon className="size-4 text-red-500" />}
          <span className="text-sm">Created email theme</span>
        </div>
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



