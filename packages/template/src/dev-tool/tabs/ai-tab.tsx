"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { convertToModelMessages, DefaultChatTransport } from "ai";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useStackApp } from "../../lib/hooks";
import { resolveApiBaseUrl } from "../dev-tool-context";
import { stackAppInternalsSymbol } from "../../lib/stack-app/common";

// IF_PLATFORM react-like

// ---------------------------------------------------------------------------
// Markdown renderer (lightweight, no external deps)
// ---------------------------------------------------------------------------

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Pattern order matters: code first (to avoid bold/italic inside code), then bold, italic, links
  const inlinePattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Inline code
      const code = match[1].slice(1, -1);
      parts.push(<code key={match.index} className="sdt-ai-inline-code">{code}</code>);
    } else if (match[2]) {
      // Bold
      const bold = match[2].slice(2, -2);
      parts.push(<strong key={match.index} className="sdt-ai-bold">{bold}</strong>);
    } else if (match[3]) {
      // Italic with *
      const italic = match[3].slice(1, -1);
      parts.push(<em key={match.index}>{italic}</em>);
    } else if (match[4]) {
      // Italic with _
      const italic = match[4].slice(1, -1);
      parts.push(<em key={match.index}>{italic}</em>);
    } else if (match[5]) {
      // Link
      parts.push(
        <a key={match.index} className="sdt-ai-link" href={match[7]} target="_blank" rel="noopener noreferrer">
          {match[6]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`sdt-ai-copy-btn ${copied ? "sdt-ai-copy-btn-copied" : ""}`}
      onClick={() => {
        runAsynchronously(navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }));
      }}
      title={copied ? "Copied!" : "Copy"}
      type="button"
    >
      {copied ? "\u2713" : "\u2398"}
    </button>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const elements: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join("\n");
      elements.push(
        <div key={elements.length} className="sdt-ai-code-block">
          <div className="sdt-ai-code-header">
            <span className="sdt-ai-code-lang">{lang || "CODE"}</span>
            <CopyButton text={code} />
          </div>
          <pre className="sdt-ai-code-pre"><code>{code}</code></pre>
        </div>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3}) (.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      elements.push(<Tag key={elements.length} className="sdt-ai-heading">{renderInline(headingMatch[2])}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="sdt-ai-hr" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={elements.length} className="sdt-ai-blockquote">
          {renderInline(quoteLines.join(" "))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[\-\*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*] /, ""));
        i++;
      }
      elements.push(
        <ul key={elements.length} className="sdt-ai-list">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={elements.length} className="sdt-ai-list sdt-ai-list-ordered">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect contiguous non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^#{1,3} /) &&
      !lines[i].startsWith("> ") &&
      !/^[\-\*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    elements.push(
      <p key={elements.length} className="sdt-ai-paragraph">
        {renderInline(paraLines.join(" "))}
      </p>
    );
  }

  return <>{elements}</>;
}

// ---------------------------------------------------------------------------
// Helpers (same as dashboard)
// ---------------------------------------------------------------------------

function getMessageContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useAIHeaders(app: ReturnType<typeof useStackApp>) {
  const headers = useRef<Record<string, string>>({});

  useEffect(() => {
    const opts = app[stackAppInternalsSymbol].getConstructorOptions();
    const h: Record<string, string> = {
      "X-Stack-Access-Type": "client",
      "X-Stack-Project-Id": app.projectId,
    };
    if ("publishableClientKey" in opts && opts.publishableClientKey) {
      h["X-Stack-Publishable-Client-Key"] = opts.publishableClientKey;
    }
    headers.current = h;
  }, [app]);

  return headers;
}

// ---------------------------------------------------------------------------
// Suggested questions
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS = [
  { icon: "\u{1F512}", text: "How do I protect a Next.js route?" },
  { icon: "\u{1F465}", text: "How do teams and permissions work?" },
  { icon: "\u{1F517}", text: "How do I add OAuth providers?" },
  { icon: "\u2709\uFE0F", text: "How do I customize auth emails?" },
];

// ---------------------------------------------------------------------------
// Message components
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div className="sdt-ai-msg sdt-ai-msg-user">
      <div className="sdt-ai-bubble sdt-ai-bubble-user">
        <p>{content}</p>
      </div>
      <div className="sdt-ai-avatar sdt-ai-avatar-user">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    </div>
  );
}

function AssistantBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="sdt-ai-msg sdt-ai-msg-assistant">
      <div className="sdt-ai-avatar sdt-ai-avatar-assistant">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </div>
      <div className="sdt-ai-bubble sdt-ai-bubble-assistant">
        {content ? (
          <MarkdownContent content={content} />
        ) : (
          <div className="sdt-ai-thinking">
            <span className="sdt-ai-thinking-dot" />
            <span className="sdt-ai-thinking-dot" />
            <span className="sdt-ai-thinking-dot" />
          </div>
        )}
        {isStreaming && content && (
          <div className="sdt-ai-streaming-indicator">
            <span className="sdt-ai-thinking-dot" />
            <span className="sdt-ai-thinking-dot" />
            <span className="sdt-ai-thinking-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AI Tab (uses useChat + DefaultChatTransport like the dashboard)
// ---------------------------------------------------------------------------

export function AITab() {
  const app = useStackApp();
  const headersRef = useAIHeaders(app);
  const apiBaseUrl = resolveApiBaseUrl(app);

  const [input, setInput] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({
    api: `${apiBaseUrl}/api/latest/ai/query/stream`,
    headers: () => headersRef.current,
    prepareSendMessagesRequest: async ({ messages: uiMessages, headers }) => {
      const modelMessages = await convertToModelMessages(uiMessages);
      return {
        body: {
          systemPrompt: "command-center-ask-ai",
          tools: ["docs"],
          quality: "smart",
          speed: "slow",
          messages: modelMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        },
        headers,
      };
    },
  }), [apiBaseUrl]);

  const {
    messages,
    status,
    sendMessage,
    setMessages,
    error: aiError,
  } = useChat({ transport });

  const aiLoading = status === "submitted" || status === "streaming";

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    if (!input.trim() || aiLoading) return;
    const text = input;
    setInput("");
    runAsynchronously(sendMessage({ text }));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [input, aiLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      setInput("");
      runAsynchronously(sendMessage({ text }));
    },
    [sendMessage]
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setMessages]);

  const isEmpty = messages.length === 0;

  return (
    <div className="sdt-ai-container">
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        className="sdt-ai-messages"
        onScroll={handleScroll}
      >
        {isEmpty ? (
          <div className="sdt-ai-empty">
            <div className="sdt-ai-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="sdt-ai-empty-title">Ask AI</div>
            <div className="sdt-ai-empty-desc">
              Get help with Stack Auth integration, troubleshooting, and best practices.
            </div>
            <div className="sdt-ai-suggestions">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  className="sdt-ai-suggestion"
                  onClick={() => handleSuggestion(q.text)}
                  type="button"
                >
                  <span className="sdt-ai-suggestion-icon">{q.icon}</span>
                  <span>{q.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="sdt-ai-message-list">
            {messages.map((msg: UIMessage) => {
              const content = getMessageContent(msg);
              if (msg.role === "user") {
                return <UserBubble key={msg.id} content={content} />;
              }
              const isLast = msg.id === messages[messages.length - 1]?.id;
              return (
                <AssistantBubble
                  key={msg.id}
                  content={content}
                  isStreaming={aiLoading && isLast}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Loading indicator when waiting for first token */}
        {aiLoading && messages.length > 0 && !getMessageContent(messages[messages.length - 1]) && messages[messages.length - 1]?.role === "assistant" && (
          <div className="sdt-ai-msg sdt-ai-msg-assistant">
            <div className="sdt-ai-avatar sdt-ai-avatar-assistant">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="sdt-ai-bubble sdt-ai-bubble-assistant">
              <div className="sdt-ai-thinking">
                <span className="sdt-ai-thinking-dot" />
                <span className="sdt-ai-thinking-dot" />
                <span className="sdt-ai-thinking-dot" />
              </div>
            </div>
          </div>
        )}

        {/* Error display */}
        {aiError && (
          <div className="sdt-ai-error">
            <span>{"\u26A0"}</span>
            <span>{aiError.message || "Something went wrong. Please try again."}</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="sdt-ai-input-area">
        {!isEmpty && (
          <button
            className="sdt-ai-new-chat"
            onClick={handleNewChat}
            title="New conversation"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
        <div className="sdt-ai-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="sdt-ai-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isEmpty ? "Ask anything about Stack Auth..." : "Ask a follow-up..."}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={aiLoading}
          />
          <button
            className={`sdt-ai-send-btn ${input.trim() && !aiLoading ? "sdt-ai-send-btn-active" : ""}`}
            onClick={handleSend}
            disabled={!input.trim() || aiLoading}
            type="button"
            title="Send"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// END_PLATFORM
