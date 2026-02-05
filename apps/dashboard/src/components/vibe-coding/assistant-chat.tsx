import { Thread } from "@/components/assistant-ui/thread";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui";

type AssistantChatProps = {
  chatAdapter: ChatModelAdapter,
  historyAdapter: ThreadHistoryAdapter,
  toolComponents: React.ReactNode,
}

export default function AssistantChat({
  chatAdapter,
  historyAdapter,
  toolComponents
}: AssistantChatProps) {
  const runtime = useLocalRuntime(
    chatAdapter,
    { adapters: { history: historyAdapter } }
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full w-full overflow-hidden border-l border-border/10 dark:border-foreground/[0.06]">
        <TooltipProvider delayDuration={300}>
          <Thread />
        </TooltipProvider>
        {toolComponents}
      </div>
    </AssistantRuntimeProvider>
  );
}
