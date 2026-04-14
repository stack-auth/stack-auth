import { cn } from "@/components/ui";
import { useDebouncedAction } from "@/hooks/use-debounced-action";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { PaperPlaneTiltIcon, SparkleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { usePathname } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CmdKPreviewProps } from "../cmdk-commands";
import {
  AssistantMessage,
  createAskAiTransport,
  getFriendlyAiErrorMessage,
  getMessageContent,
  getToolInvocations,
  UserMessage,
  useWordStreaming
} from "./ai-chat-shared";


/**
 * AI Chat Preview Component
 *
 * Displays an AI chat conversation. Sends the initial query on mount
 * and supports follow-up questions.
 */
export function AIChatPreview({ query, ...rest }: CmdKPreviewProps) {
  return <AIChatPreviewInner key={query} query={query} {...rest} />;
}


const AIChatPreviewInner = memo(function AIChatPreview({
  query,
  registerOnFocus,
  unregisterOnFocus,
  onBlur,
}: CmdKPreviewProps) {
  const [followUpInput, setFollowUpInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const currentUser = useUser();
  const pathname = usePathname();
  const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : undefined;

  const trimmedQuery = query.trim();

  const {
    messages,
    status,
    sendMessage,
    error: aiError,
  } = useChat({
    transport: createAskAiTransport({ currentUser, projectId }),
  });

  const aiLoading = status === "submitted" || status === "streaming";

  // Send initial query on mount (once) with debounce
  useDebouncedAction({
    action: async () => {
      await sendMessage({ text: trimmedQuery });
    },
    delayMs: 400,
    skip: !trimmedQuery,
  });

  // Word streaming for the last assistant message
  const lastAssistantMessage = messages.slice(1).reverse().find((m: UIMessage) => m.role === "assistant");
  const lastAssistantContent = lastAssistantMessage ? getMessageContent(lastAssistantMessage) : "";
  const { displayedWordCount, getDisplayContent, isRevealing } = useWordStreaming(lastAssistantContent);
  const isStreaming = aiLoading && lastAssistantMessage;

  // Focus handler registration
  useEffect(() => {
    const focusHandler = () => {
      followUpInputRef.current?.focus();
      followUpInputRef.current?.select();
    };
    registerOnFocus(focusHandler);
    return () => unregisterOnFocus(focusHandler);
  }, [registerOnFocus, unregisterOnFocus]);

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Auto-scroll when new messages are added or when already at bottom
  useEffect(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const messageCount = messages.length;

    if (messageCount > lastMessageCountRef.current) {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
    } else if (aiLoading && isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    lastMessageCountRef.current = messageCount;
  }, [messages, aiLoading]);

  // Handle follow-up questions
  const handleFollowUp = useCallback(() => {
    const input = followUpInput.trim();
    if (!input || aiLoading) return;
    setFollowUpInput("");
    // runAsynchronously intentionally used instead of runAsynchronouslyWithAlert:
    // sendMessage errors are already surfaced to the user via the aiError state below.
    runAsynchronously(sendMessage({ text: input }));
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [followUpInput, sendMessage, aiLoading]);

  // Handle follow-up input keyboard
  const handleFollowUpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        runAsynchronously(handleFollowUp());
      } else if (e.key === "ArrowLeft") {
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          e.stopPropagation();
          onBlur();
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        const container = messagesContainerRef.current;
        if (container) {
          const scrollAmount = e.key === "ArrowUp" ? -100 : 100;
          container.scrollBy({ top: scrollAmount, behavior: "smooth" });
        }
      }
    },
    [handleFollowUp, onBlur]
  );

  // Determine what to show in the loading state
  const showLoadingIndicator = messages.length === 0 || (aiLoading && !messages.some((m: UIMessage) => m.role === "assistant" && getMessageContent(m)));

  return (
    <div className="flex flex-col h-full w-full">
      {/* Messages - skip the first user message (the initial query) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {messages.slice(1).map((message: UIMessage, index: number, arr: UIMessage[]) => {
          const messageContent = getMessageContent(message);
          const toolInvocations = message.role === "assistant" ? getToolInvocations(message) : [];

          // For the last assistant message, apply word-by-word streaming
          const isLastAssistant = message.role === "assistant" &&
            index === arr.length - 1 - (arr[arr.length - 1]?.role === "user" ? 1 : 0);
          const displayContent = message.role === "assistant" && isLastAssistant
            ? getDisplayContent(messageContent)
            : messageContent;

          // Don't render if no content to show yet AND no tool invocations
          if (message.role === "assistant" && isLastAssistant && !displayContent && toolInvocations.length === 0) {
            return null;
          }

          if (message.role === "user") {
            return <UserMessage key={message.id || index} content={messageContent} />;
          }
          return (
            <AssistantMessage
              key={message.id || index}
              content={displayContent}
              toolInvocations={toolInvocations}
            />
          );
        })}

        {/* Loading indicator */}
        {showLoadingIndicator && (
          <div className="flex gap-2.5 justify-start">
            <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center">
              <SparkleIcon className="h-3 w-3 text-purple-400" />
            </div>
            <div className="bg-foreground/[0.02] rounded-xl px-3.5 py-2">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && displayedWordCount > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 pl-8">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error display */}
        {aiError && (
          <div className="flex items-start gap-2 text-[12px] text-red-400/90 px-3 py-2 bg-red-500/[0.08] rounded-lg ring-1 ring-red-500/20">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{getFriendlyAiErrorMessage(aiError)}</span>
          </div>
        )}
      </div>

      {/* Follow-up input */}
      <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-1.5 ring-1 ring-foreground/[0.05] focus-within:ring-purple-500/25 transition-shadow">
          <input
            ref={followUpInputRef}
            type="text"
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            onKeyDown={handleFollowUpKeyDown}
            placeholder="Ask a follow-up question..."
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            onClick={() => runAsynchronously(handleFollowUp())}
            disabled={!followUpInput.trim() || aiLoading}
            className={cn(
              "p-1 rounded transition-colors hover:transition-none",
              followUpInput.trim() && !aiLoading
                ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                : "text-muted-foreground/25 cursor-not-allowed"
            )}
            type="button"
          >
            <PaperPlaneTiltIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/40 mt-1.5 text-center">
          Enter to send
        </p>
      </div>
    </div>
  );
});
