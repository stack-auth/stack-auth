import { Thread } from "@/components/assistant-ui/thread";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { TooltipProvider } from "@stackframe/stack-ui";

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
      {toolComponents}
      <TooltipProvider>
        <Thread />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
