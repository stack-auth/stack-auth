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
      <div className="flex flex-col h-full w-full overflow-hidden">
        <TooltipProvider>
          <Thread />
        </TooltipProvider>
        {toolComponents}
      </div>
    </AssistantRuntimeProvider>
  );
}
