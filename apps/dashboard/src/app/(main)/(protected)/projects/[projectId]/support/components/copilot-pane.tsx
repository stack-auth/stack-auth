"use client";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoConversation, DossierField } from "../fixtures";
import { buildInitialCopilotMessages, createMockCopilotAdapter } from "../mock-copilot-adapter";
import { ApprovalCard } from "./approval-card";
import { DocsSuggestionCard } from "./docs-suggestion-card";
import { DossierCard } from "./dossier-card";

const RUNNING_STATUS_MESSAGES = ["Looking at the seeded context..."];

/**
 * Keyed by conversation id from the parent so the runtime and canned script
 * reset cleanly whenever the selected conversation changes.
 */
export function CopilotPane(props: {
  conversation: DemoConversation,
  revealedDossierFields: ReadonlySet<DossierField>,
  onThreadEffect: (body: string) => void,
}) {
  const { conversation, onThreadEffect } = props;

  // The dossier folds away once the operator starts working with the copilot,
  // so the conversation (and any approval card) has the pane to itself.
  const [dossierExpanded, setDossierExpanded] = useState(true);

  // Route thread effects through a ref so the adapter (and runtime) survive
  // parent re-renders; only a conversation switch rebuilds them.
  const onThreadEffectRef = useRef(onThreadEffect);
  useEffect(() => {
    onThreadEffectRef.current = onThreadEffect;
  }, [onThreadEffect]);
  const adapter = useMemo(
    () => createMockCopilotAdapter(conversation, {
      onThreadEffect: (body) => onThreadEffectRef.current(body),
      onRunStart: () => setDossierExpanded(false),
    }),
    [conversation],
  );
  const initialMessages = useMemo(() => buildInitialCopilotMessages(conversation), [conversation]);
  const runtime = useLocalRuntime(adapter, { initialMessages });

  const assistantContentComponents = useMemo(() => ({
    Text: MarkdownText,
    tools: { by_name: { "request-approval": ApprovalCard }, Fallback: ToolFallback },
  }), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-4 py-3.5">
        <SparkleIcon className="h-3.5 w-3.5 text-purple-400/70" />
        <span className="text-sm font-medium tracking-tight text-foreground">Copilot</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">SQL · docs · replays · replies</span>
      </div>

      <div className="max-h-[34%] shrink-0 overflow-y-auto">
        <DossierCard
          conversation={conversation}
          revealedFields={props.revealedDossierFields}
          expanded={dossierExpanded}
          onToggle={() => setDossierExpanded((prev) => !prev)}
        />
        {conversation.docsSuggestion && <DocsSuggestionCard suggestion={conversation.docsSuggestion} />}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <AssistantRuntimeProvider runtime={runtime}>
          <Thread
            composerPlaceholder="Ask about this customer..."
            runningStatusMessages={RUNNING_STATUS_MESSAGES}
            assistantContentComponents={assistantContentComponents}
            hideMessageActions
            autoFocusComposer={false}
          />
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
}
