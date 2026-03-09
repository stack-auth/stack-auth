'use client';

import { useChat } from '@ai-sdk/react';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { MessageFormatter } from './message-formatter';

export function FloatingAIChat() {
  const [isExpanded, setIsExpanded] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
  } = useChat({
    api: '/api/chat',
    initialMessages: [],
    onError: (err: Error) => {
      console.error('Chat error:', err);
    },
  });

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    if (isNearBottom || messages.length === 0) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [messages]);

  // Sync contentEditable with input state
  useEffect(() => {
    if (editableRef.current && editableRef.current.textContent !== input) {
      editableRef.current.textContent = input;
    }
  }, [input]);

  const handleChatSubmit = (e: React.FormEvent) => {
    if (!input.trim()) return;
    setIsExpanded(true);
    handleSubmit(e);
  };

  const handleSubmitSafely = () => {
    runAsynchronously(async () => {
      handleChatSubmit({} as React.FormEvent);
    });
  };

  return (
    <div className={cn(
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out",
      isExpanded ? "w-[min(640px,calc(100vw-2rem))]" : "w-[min(480px,calc(100vw-2rem))]"
    )}>
      {/* Messages area - only shown when expanded */}
      {isExpanded && messages.length > 0 && (
        <div className="mb-2 rounded-xl border border-fd-border bg-fd-background shadow-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-fd-border">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-fd-primary" />
              <span className="text-sm font-medium text-fd-foreground">AI Chat</span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 text-fd-muted-foreground hover:text-fd-foreground rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div ref={messagesContainerRef} className="max-h-80 overflow-y-auto p-3 space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={cn(
                    "max-w-[85%] p-2.5 rounded-lg text-sm",
                    message.role === 'user'
                      ? 'bg-fd-primary/10 border border-fd-primary/20 text-fd-foreground'
                      : 'bg-fd-muted text-fd-foreground border border-fd-border'
                  )}
                >
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  ) : (
                    <MessageFormatter content={message.content} />
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="p-2.5 rounded-lg bg-fd-muted border border-fd-border">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-fd-foreground">Thinking</span>
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-red-500 text-xs p-2 bg-red-500/10 rounded border border-red-500/20">
                Error: {error.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="relative rounded-2xl border-2 border-fd-border bg-fd-background px-4 py-2.5">
        {/* Gradient glow behind input */}
        <div className="absolute -inset-3 rounded-3xl bg-fd-background/80 blur-xl -z-10" />
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-fd-muted-foreground flex-shrink-0" />
          <div className="flex-1 flex items-center">
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning={true}
              className="text-fd-foreground w-full resize-none border-none bg-transparent shadow-none outline-none focus-visible:ring-0 text-sm empty:before:content-[attr(data-placeholder)] empty:before:text-fd-muted-foreground"
              style={{ lineHeight: "1.4", minHeight: "20px" }}
              onInput={(e) => {
                const value = e.currentTarget.textContent || "";
                handleInputChange({
                  target: { value },
                } as React.ChangeEvent<HTMLInputElement>);
                if (!value.trim()) {
                  e.currentTarget.innerHTML = "";
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitSafely();
                }
              }}
              onFocus={() => {
                if (messages.length > 0) {
                  setIsExpanded(true);
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain");
                e.currentTarget.textContent =
                  (e.currentTarget.textContent || "") + text;
                const value = e.currentTarget.textContent;
                handleInputChange({
                  target: { value },
                } as React.ChangeEvent<HTMLInputElement>);
              }}
              data-placeholder="Ask about Stack Auth..."
            />
          </div>
          <button
            disabled={!input.trim() || isLoading}
            onClick={handleSubmitSafely}
            className="h-7 w-7 rounded-full shrink-0 bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
