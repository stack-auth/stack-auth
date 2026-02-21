'use client';

import { useChat, type UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { ChevronDown, ChevronUp, ExternalLink, FileText, Maximize2, Minimize2, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';
import { MessageFormatter } from './message-formatter';

type ToolInvocationPart = {
  type: `tool-${string}`,
  toolCallId: string,
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | "approval-requested" | "approval-responded" | "output-denied",
  input: unknown,
  output?: unknown,
  errorText?: string,
};

function getMessageContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text", text: string } => part.type === "text")
    .map(part => part.text)
    .join("");
}

function getToolInvocations(message: UIMessage): ToolInvocationPart[] {
  return message.parts
    .filter((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool")
    .map((part) => part as unknown as ToolInvocationPart);
}

// Stack Auth Icon Component (just the icon, not full logo)
function StackIcon({ size = 20, className }: { size?: number, className?: string }) {
  return (
    <svg
      width={size}
      height={size * (242/200)} // Maintain aspect ratio
      viewBox="0 0 200 242"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
    </svg>
  );
}

// Separate component for search results to properly use React hooks
const SearchDocsDisplay = ({ toolCall }: { toolCall: { toolName: string, args?: { search_query?: string }, result?: { content?: { text: string }[], text?: string } } | string }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const query = (toolCall as { args?: { search_query?: string } }).args?.search_query || "...";
  // Try multiple ways to get the result text
  const resultText = ((toolCall as { result?: { content?: { text: string }[], text?: string } }).result?.content?.[0]?.text
    || (toolCall as { result?: { content?: { text: string }[], text?: string } }).result?.text
    || (typeof (toolCall as { result?: string }).result === 'string' ? (toolCall as { result?: string }).result : undefined)) ?? "";

  // Count how many results were found
  const resultCount = (resultText.match(/Title:/g) || []).length;

  // Parse search results
  const parseSearchResults = () => {
    const results = [];
    const sections = resultText.split('---').map((s: string) => s.trim()).filter(Boolean);

    for (const section of sections) {
      const titleMatch = section.match(/Title:\s*([^\n]+)/);
      const descMatch = section.match(/Description:\s*([^\n]+)/);
      const urlMatch = section.match(/Documentation URL:\s*([^\n]+)/);
      const endpointMatch = section.match(/API Endpoint:\s*([^\n]+)/);
      const scoreMatch = section.match(/Score:\s*(\d+)/);

      if (titleMatch) {
        results.push({
          title: titleMatch[1].trim(),
          description: descMatch?.[1]?.trim(),
          url: urlMatch?.[1]?.trim(),
          endpoint: endpointMatch?.[1]?.trim(),
          score: scoreMatch?.[1] ? parseInt(scoreMatch[1]) : 0,
        });
      }
    }

    return results.slice(0, 10); // Limit to top 10 for display
  };

  const results = parseSearchResults();

  return (
    <div className="flex flex-col bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 p-2 w-full text-left hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors rounded-lg"
      >
        <FileText className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
        <span className="text-purple-700 dark:text-purple-300 font-medium flex-1">
          Searched for &quot;{query}&quot; • {resultCount} {resultCount === 1 ? 'result' : 'results'}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
        )}
      </button>

      {isExpanded && results.length > 0 && (
        <div className="px-2 pb-2 space-y-1.5 max-h-64 overflow-y-auto">
          {results.map((result, idx) => (
            <div
              key={idx}
              className="p-2 bg-white dark:bg-gray-900/50 rounded border border-purple-200/50 dark:border-purple-800/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-purple-900 dark:text-purple-100 truncate">
                    {result.title}
                  </div>
                  {result.endpoint && (
                    <div className="text-purple-600 dark:text-purple-400 font-mono text-[10px] mt-0.5">
                      {result.endpoint}
                    </div>
                  )}
                  {result.description && (
                    <div className="text-purple-700 dark:text-purple-300 text-[10px] mt-1 line-clamp-2">
                      {result.description}
                    </div>
                  )}
                </div>
                {result.url && (
                  <a
                    href={`https://docs.stack-auth.com${result.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Component to render tool calls
const ToolCallDisplay = ({
  toolCall,
}: {
  toolCall: { toolName: string, args?: { id?: string, search_query?: string }, result?: { content?: { text: string }[], text?: string } },
}) => {
  // Handle search_docs tool
  if (toolCall.toolName === "search_docs") {
    return <SearchDocsDisplay toolCall={toolCall} />;
  }

  // Handle get_docs_by_id and fetch tools (they work the same)
  if (toolCall.toolName === "get_docs_by_id" || toolCall.toolName === "fetch") {
    const docId = toolCall.args?.id;
    let docTitle = "Loading...";
    let apiEndpoint: string | null = null;

    // Try multiple ways to get the result text
    const resultText = (toolCall.result?.content?.[0]?.text
      || toolCall.result?.text
      || (typeof toolCall.result === 'string' ? toolCall.result : undefined)) ?? "";

    // Extract title - more robust matching
    const titleMatch = resultText.match(/Title:\s*([^\n]+)/);
    if (titleMatch?.[1]) {
      docTitle = titleMatch[1].trim();
    } else {
      // Fallback: try to extract from the docId if available
      if (docId) {
        const pathParts = String(docId).split('/').filter(Boolean);
        docTitle = pathParts[pathParts.length - 1]?.replace(/-/g, ' ') || 'Documentation';
      } else {
        docTitle = 'Documentation';
      }
    }

    // Extract API endpoint if present
    const endpointMatch = resultText.match(/API Endpoint:\s*([^\n]+)/);
    if (endpointMatch?.[1]) {
      apiEndpoint = endpointMatch[1].trim();
    }

    return (
      <div className="flex flex-col gap-1 p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs mb-2">
        <div className="flex items-center gap-2">
          <FileText className="w-3 h-3 text-blue-600 dark:text-blue-400" />
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            {docTitle}
          </span>
          {docId && (
            <a
              href={`https://docs.stack-auth.com${encodeURI(
                (String(docId).startsWith('/') ? String(docId) : `/${String(docId)}`)
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors ml-auto"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Open</span>
            </a>
          )}
        </div>
        {apiEndpoint && (
          <div className="pl-5 text-blue-600 dark:text-blue-400 font-mono">
            {apiEndpoint}
          </div>
        )}
      </div>
    );
  }

  // Handle search tool (for ChatGPT compatibility)
  if (toolCall.toolName === "search") {
    // Try multiple ways to get the result text
    const resultText = (toolCall.result?.content?.[0]?.text
      || toolCall.result?.text
      || (typeof toolCall.result === 'string' ? toolCall.result : undefined)) ?? "";
    let resultCount = 0;

    try {
      const parsed = JSON.parse(resultText);
      resultCount = parsed.results?.length || 0;
    } catch {
      // If not JSON, try counting
      resultCount = (resultText.match(/title:/gi) || []).length;
    }

    return (
      <div className="flex items-center gap-2 p-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs mb-2">
        <FileText className="w-3 h-3 text-purple-600 dark:text-purple-400" />
        <span className="text-purple-700 dark:text-purple-300 font-medium">
          Searched • {resultCount} {resultCount === 1 ? 'result' : 'results'}
        </span>
      </div>
    );
  }

  return null;
};

export function AIChatDrawer() {
  const sidebarContext = useSidebar();
  const { isChatOpen, isChatExpanded, toggleChat, setChatExpanded } = sidebarContext || {
    isChatOpen: false,
    isChatExpanded: false,
    toggleChat: () => {},
    setChatExpanded: () => {},
  };

  const editableRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isHomePage, setIsHomePage] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [pageLoadTime] = useState(Date.now());
  const [sessionId, setSessionId] = useState(() => {
    // Generate or retrieve session ID
    if (typeof window !== 'undefined') {
      const existing = localStorage.getItem('ai-chat-session-id');
      if (existing) {
        return existing;
      }
    }
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    if (typeof window !== 'undefined') {
      localStorage.setItem('ai-chat-session-id', newId);
    }
    return newId;
  });
  const [sessionData, setSessionData] = useState({
    timeOnPage: 0,
    messageCount: 0,
  });

  // Track session data
  useEffect(() => {
    const updateSessionData = () => {
      const timeOnPage = Math.floor((Date.now() - pageLoadTime) / 1000);

      setSessionData(prev => ({
        ...prev,
        timeOnPage,
      }));
    };

    const interval = setInterval(updateSessionData, 5000); // Update every 5 seconds

    return () => {
      clearInterval(interval);
    };
  }, [pageLoadTime]);

  // Reset session ID if user has been inactive for too long
  useEffect(() => {
    const checkSessionExpiry = () => {
      if (typeof window === 'undefined') return;

      const lastActivity = localStorage.getItem('ai-chat-last-activity');
      if (lastActivity) {
        const timeSinceActivity = Date.now() - parseInt(lastActivity);
        const ONE_HOUR = 60 * 60 * 1000;

        if (timeSinceActivity > ONE_HOUR) {
          // Generate new session ID
          const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
          localStorage.setItem('ai-chat-session-id', newId);
          setSessionId(newId); // Update the component state
          setSessionData(prev => ({ ...prev, messageCount: 0 }));
        }
      }
    };

    checkSessionExpiry();
  }, []);

  // Detect if we're on homepage and scroll state
  useEffect(() => {
    const checkHomePage = () => {
      setIsHomePage(document.body.classList.contains('home-page'));
    };

    const checkScrolled = () => {
      setIsScrolled(document.body.classList.contains('scrolled'));
    };

    // Initial check
    checkHomePage();
    checkScrolled();

    // Set up observers for class changes
    const observer = new MutationObserver(() => {
      checkHomePage();
      checkScrolled();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);


  // Calculate position based on homepage and scroll state
  const topPosition = 'top-3';
  const height = isHomePage && isScrolled ? 'h-[calc(100vh-1.5rem)]' : 'h-[calc(100vh-1.5rem)]';

  const [input, setInput] = useState('');

  const {
    messages,
    sendMessage,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onError: (error: Error) => {
      console.error('Chat error:', error);
    },
    onFinish: ({ message }: { message: UIMessage }) => {
      runAsynchronously(() => sendAIResponseToDiscord(getMessageContent(message)));
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Debug: log messages, status, and errors
  useEffect(() => {
    console.log('[docs-chat] status:', status);
    console.log('[docs-chat] error:', error);
    console.log('[docs-chat] messages:', JSON.stringify(messages.map(m => ({
      id: m.id,
      role: m.role,
      parts: m.parts.map(p => ({ type: p.type, ...(p.type === 'text' ? { text: (p as { text: string }).text.slice(0, 100) } : {}) })),
    })), null, 2));
  }, [messages, status, error]);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Check if user is near the bottom (within 100px)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    // Only auto-scroll if user is near the bottom or if this is a new message
    if (isNearBottom || messages.length === 0) {
      // Use requestAnimationFrame for smoother scrolling during streaming
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

  const submitMessage = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    if (editableRef.current) editableRef.current.textContent = '';
    runAsynchronously(() => sendMessage({ text }));
  };

  // Function to send AI response to Discord webhook
  const sendAIResponseToDiscord = async (response: string) => {
    try {
      const context = {
        response: response,
        metadata: {
          sessionId: sessionId,
          model: 'anthropic/claude-4.5-sonnet',
          temperature: 0,
        }
      };

      await fetch('/api/discord-webhook/response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(context),
      });
    } catch (error) {
      console.error('Failed to send AI response to Discord:', error);
    }
  };

  // Function to send message to Discord webhook
  const sendToDiscord = async (message: string) => {
    try {
      // Update message count and last activity
      const newMessageCount = sessionData.messageCount + 1;
      if (typeof window !== 'undefined') {
        localStorage.setItem('ai-chat-last-activity', Date.now().toString());
      }

      // Gather only essential context
      const context = {
        message: message,
        username: 'Stack Auth Docs User',
        metadata: {
          sessionId: sessionId,
          messageNumber: newMessageCount,
          pathname: typeof window !== 'undefined' ? window.location.pathname : '',
          timestamp: new Date().toISOString(),
          userAgent: typeof window !== 'undefined' ? navigator.userAgent : '',
          messageType: starterPrompts.some(p => p.prompt === message) ? 'starter-prompt' : 'custom',
          timeOnPage: sessionData.timeOnPage,
          isFollowUp: newMessageCount > 1,
        }
      };

      await fetch('/api/discord-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(context),
      });
    } catch (error) {
      console.error('Failed to send message to Discord:', error);
    }
  };

  // Enhanced submit handler that also sends to Discord
  const handleChatSubmit = () => {
    if (!input.trim() || isLoading) return;

    // Update session data
    setSessionData(prev => ({
      ...prev,
      messageCount: prev.messageCount + 1,
    }));

    // Send message to Discord webhook
    runAsynchronously(() => sendToDiscord(input.trim()));

    submitMessage();
  };

  // Starter prompts for users
  const starterPrompts = [
    {
      title: "Getting Started",
      description: "Setup and installation",
      prompt: "How do I get started with Stack Auth?"
    },
    {
      title: "Next.js Integration",
      description: "Framework setup",
      prompt: "How do I implement authentication in Next.js?"
    },
    {
      title: "Authentication Methods",
      description: "Available options",
      prompt: "What authentication methods does Stack Auth support?"
    }
  ];

  const handleStarterPromptClick = (prompt: string) => {
    setInput(prompt);
    if (editableRef.current) editableRef.current.textContent = prompt;
  };

  return (
    <div
      className={`fixed ${topPosition} right-3 ${height} mb-3 bg-fd-background border border-fd-border rounded-xl flex flex-col transition-all duration-300 ease-out z-50 shadow-lg ${
        isChatExpanded ? 'w-[70vw] z-[70]' : 'w-96'
      } ${
        isChatOpen ? 'translate-x-0' : 'translate-x-[calc(100%+0.75rem)]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-fd-border bg-fd-background rounded-t-xl">
        <div className="flex items-center gap-2">
          <StackIcon size={18} className="text-fd-primary" />
          <div>
            <h3 className="font-medium text-fd-foreground text-sm">Stack Auth AI</h3>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Expand/Collapse Button */}
          <button
            onClick={() => setChatExpanded(!isChatExpanded)}
            className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors"
            title={isChatExpanded ? 'Collapse chat' : 'Expand chat'}
          >
            {isChatExpanded ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
          </button>
          {/* Close Button */}
          <button
            onClick={toggleChat}
            className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors"
            title="Close chat"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Experimental Banner */}
      <div className="px-3 py-2 bg-yellow-500/5 border-b border-yellow-500/10">
        <p className="text-xs text-fd-muted-foreground">
          <span className="text-yellow-600 dark:text-yellow-400 font-medium">Experimental:</span> AI responses may not always be accurate—please verify important details.<br />
          <br />
          For the most accurate information, please <a href="https://discord.stack-auth.com" className="text-fd-primary hover:underline">join our Discord</a> or <a href="mailto:team@stack-auth.com" className="text-fd-primary hover:underline">email us</a>.
        </p>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-6">
            <StackIcon size={24} className="text-fd-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium text-fd-foreground mb-2 text-sm">How can I help?</h3>
            <p className="text-fd-muted-foreground text-xs mb-4">
              Ask me about Stack Auth while you browse the docs.
            </p>
            <div className="space-y-1.5">
              {starterPrompts.map((starter, index) => (
                <button
                  key={index}
                  onClick={() => handleStarterPromptClick(starter.prompt)}
                  className="w-full p-2.5 text-left text-xs bg-fd-muted/30 hover:bg-fd-muted/60 rounded-md border border-fd-border/50 transition-colors"
                >
                  <div className="font-medium">{starter.title}</div>
                  <div className="text-fd-muted-foreground">{starter.description}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const messageContent = getMessageContent(message);
            const toolInvocations = message.role === "assistant" ? getToolInvocations(message) : [];

            if (message.role === "assistant" && !messageContent && toolInvocations.length === 0) {
              return null;
            }

            return (
              <div
                key={message.id}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[85%] p-2 rounded-lg text-xs ${
                    message.role === 'user'
                      ? 'bg-fd-primary/10 border border-fd-primary/20 text-fd-foreground'
                      : 'bg-fd-muted text-fd-foreground border border-fd-border'
                  }`}
                >
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words">
                      {messageContent}
                    </div>
                  ) : (
                    <>
                      {toolInvocations.map((part, index) => (
                        <ToolCallDisplay
                          key={index}
                          toolCall={{
                            toolName: part.type === "dynamic-tool" ? (part as unknown as { toolName: string }).toolName : part.type.replace(/^tool-/, ""),
                            args: part.input as { id?: string, search_query?: string },
                            result: part.output as { content?: { text: string }[], text?: string } | undefined,
                          }}
                        />
                      ))}
                      {messageContent && <MessageFormatter content={messageContent} />}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="p-2">
              <div className="rounded-lg bg-fd-muted border border-fd-border p-3">
                <div className="flex items-center gap-3">
                  <StackIcon size={18} className="text-fd-primary" />
                  <span className="text-fd-foreground font-medium text-sm">Thinking</span>
                  <div className="flex space-x-1.5 ml-2">
                    <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-fd-primary rounded-full animate-bounce [animation-delay:0.15s]"></div>
                  </div>
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

        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3">
        <div className="border-input bg-background cursor-text rounded-3xl border px-3 py-2 shadow-xs">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center">
              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning={true}
                className="text-primary w-full resize-none border-none bg-transparent shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm empty:before:content-[attr(data-placeholder)] empty:before:text-fd-muted-foreground"
                style={{ lineHeight: "1.4", minHeight: "20px" }}
                onInput={(e) => {
                  const value = e.currentTarget.textContent || "";
                  setInput(value);
                  // Clean up the div if it's empty to show placeholder
                  if (!value.trim()) {
                    e.currentTarget.innerHTML = "";
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text/plain");
                  e.currentTarget.textContent =
                    (e.currentTarget.textContent || "") + text;
                  setInput(e.currentTarget.textContent || "");
                }}
                data-placeholder="Ask about Stack Auth..."
              />
            </div>
            <button
              disabled={!input.trim() || isLoading}
              onClick={handleChatSubmit}
              className="h-8 w-8 rounded-full p-0 shrink-0 bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
