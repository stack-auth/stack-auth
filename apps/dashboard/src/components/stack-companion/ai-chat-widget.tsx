'use client';

import { cn } from "@/components/ui";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { ArrowCounterClockwiseIcon, PaperPlaneTiltIcon, SparkleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantMessage,
  createAskAiTransport,
  getMessageContent,
  getToolInvocations,
  UserMessage,
  useWordStreaming,
} from "../commands/ai-chat-shared";

export function AIChatWidget() {
  const [input, setInput] = useState("");
  const [conversationStarted, setConversationStarted] = useState(false);
  const [conversationKey, setConversationKey] = useState(0);

  return (
    <AIChatWidgetInner
      key={conversationKey}
      input={input}
      setInput={setInput}
      conversationStarted={conversationStarted}
      setConversationStarted={setConversationStarted}
      onNewConversation={() => {
        setConversationKey(prev => prev + 1);
        setConversationStarted(false);
        setInput("");
      }}
    />
  );
}

function AIChatWidgetInner({
  input,
  setInput,
  conversationStarted,
  setConversationStarted,
  onNewConversation,
}: {
  input: string,
  setInput: (v: string) => void,
  conversationStarted: boolean,
  setConversationStarted: (v: boolean) => void,
  onNewConversation: () => void,
}) {
  const [followUpInput, setFollowUpInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const currentUser = useUser();
  const pathname = usePathname();
  const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : undefined;

  const {
    messages,
    status,
    sendMessage,
    error: aiError,
  } = useChat({
    transport: createAskAiTransport({ currentUser, projectId }),
  });

  const aiLoading = status === "submitted" || status === "streaming";

  // Word streaming for the last assistant message
  const lastAssistantMessage = messages.slice().reverse().find((m: UIMessage) => m.role === "assistant");
  const lastAssistantContent = lastAssistantMessage ? getMessageContent(lastAssistantMessage) : "";
  const { displayedWordCount, getDisplayContent, isRevealing } = useWordStreaming(lastAssistantContent);
  const isStreaming = aiLoading && lastAssistantMessage;

  // Auto-focus input on mount
  useEffect(() => {
    if (!conversationStarted) {
      inputRef.current?.focus();
    }
  }, [conversationStarted]);

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

  // Handle initial question submit
  const handleSubmit = useCallback(() => {
    if (!input.trim() || aiLoading) return;
    setConversationStarted(true);
    runAsynchronously(sendMessage({ text: input.trim() }));
    setInput("");
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [input, aiLoading, sendMessage, setConversationStarted, setInput]);

  // Handle initial input keyboard
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Handle follow-up questions
  const handleFollowUp = useCallback(() => {
    const text = followUpInput.trim();
    if (!text || aiLoading) return;
    setFollowUpInput("");
    runAsynchronously(sendMessage({ text }));
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
        handleFollowUp();
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
    [handleFollowUp]
  );

  // Determine what to show in the loading state
  const showLoadingIndicator = conversationStarted && (messages.length === 0 || (aiLoading && !messages.some((m: UIMessage) => m.role === "assistant" && getMessageContent(m))));

  // Initial state - show input
  if (!conversationStarted) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
            <SparkleIcon className="h-5 w-5 text-purple-400" />
          </div>
          <div className="text-center space-y-1.5">
            <h3 className="text-sm font-semibold text-foreground">Ask AI</h3>
            <p className="text-xs text-muted-foreground/70 max-w-[240px]">
              Get AI-powered answers about Stack Auth, your project, and analytics
            </p>
          </div>
        </div>

        <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-1.5 ring-1 ring-foreground/[0.05] focus-within:ring-purple-500/25 transition-shadow">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Ask a question..."
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || aiLoading}
              aria-label="Send message"
              className={cn(
                "p-1 rounded transition-colors hover:transition-none",
                input.trim() && !aiLoading
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
  }

  // Conversation view
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {messages.map((message: UIMessage, index: number, arr: UIMessage[]) => {
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
        {(isStreaming || isRevealing) && displayedWordCount > 0 && (
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
            <span>{aiError.message || "Failed to get response. Please try again."}</span>
          </div>
        )}
      </div>

      {/* Follow-up input + new conversation button */}
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
            onClick={() => handleFollowUp()}
            disabled={!followUpInput.trim() || aiLoading}
            aria-label="Send message"
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
        <div className="flex items-center justify-between mt-1.5">
          <button
            onClick={onNewConversation}
            disabled={aiLoading}
            className={cn(
              "flex items-center gap-1 text-[9px] transition-colors hover:transition-none",
              aiLoading
                ? "text-muted-foreground/25 cursor-not-allowed"
                : "text-muted-foreground/40 hover:text-muted-foreground/70"
            )}
            type="button"
          >
            <ArrowCounterClockwiseIcon className="h-2.5 w-2.5" />
            <span>New conversation</span>
          </button>
          <p className="text-[9px] text-muted-foreground/40">
            Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
