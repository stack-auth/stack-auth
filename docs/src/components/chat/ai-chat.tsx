'use client';

import { useChat } from '@ai-sdk/react';
import { Maximize2, Minimize2, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';
import { MessageFormatter } from './message-formatter';

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

export function AIChatDrawer() {
  const sidebarContext = useSidebar();
  const { isChatOpen, isChatExpanded, toggleChat, setChatExpanded } = sidebarContext || {
    isChatOpen: false,
    isChatExpanded: false,
    toggleChat: () => {},
    setChatExpanded: () => {},
  };

  const [docsContent, setDocsContent] = useState('');
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

  // Fetch documentation content when component mounts with caching
  useEffect(() => {
    let isCancelled = false;

    const fetchDocs = async () => {
      try {
        // Check cache first (10 minute TTL)
        if (typeof window !== 'undefined') {
          const cached = sessionStorage.getItem('ai-chat-docs-cache');
          if (cached) {
            const { content, timestamp } = JSON.parse(cached);
            const CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

            if (Date.now() - timestamp < CACHE_TTL) {
              // Cache is still valid, use cached content
              if (!isCancelled) {
                setDocsContent(content);
              }
              return;
            }
          }
        }

        // Cache miss or expired, fetch fresh content
        const response = await fetch('/llms.txt');
        if (response.ok && !isCancelled) {
          const content = await response.text();
          setDocsContent(content);

          // Cache the fresh content
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('ai-chat-docs-cache', JSON.stringify({
              content,
              timestamp: Date.now()
            }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch documentation:', error);
      }
    };

    fetchDocs().catch((error) => {
      console.error('Failed to fetch documentation:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Calculate position based on homepage and scroll state
  const topPosition = isHomePage && isScrolled ? 'top-0' : 'top-14';
  const height = isHomePage && isScrolled ? 'h-screen' : 'h-[calc(100vh-3.5rem)]';

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
    body: {
      docsContent,
    },
    onError: (error: Error) => {
      console.error('Chat error:', error);
    },
    onFinish: (message) => {
      // Send AI response to Discord
      sendAIResponseToDiscord(message.content).catch(error => {
        console.error('Failed to send AI response to Discord:', error);
      });
    },
  });

  // Function to send AI response to Discord webhook
  const sendAIResponseToDiscord = async (response: string) => {
    try {
      const context = {
        response: response,
        metadata: {
          sessionId: sessionId,
          model: 'gemini-2.0-flash',
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
  const handleChatSubmit = async (e: React.FormEvent) => {
    if (!input.trim()) return;

    // Update session data
    setSessionData(prev => ({
      ...prev,
      messageCount: prev.messageCount + 1,
    }));

    // Send message to Discord webhook
    sendToDiscord(input.trim()).catch(error => {
      console.error('Discord webhook error:', error);
    });

    // Continue with normal chat submission
    handleSubmit(e);
  };

  // Non-async wrapper for form onSubmit to avoid promise issues
  const handleFormSubmit = (e: React.FormEvent) => {
    handleChatSubmit(e).catch(error => {
      console.error('Chat submit error:', error);
    });
  };

  // Non-async handler for onKeyDown to avoid promise issues
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit(e as React.FormEvent).catch(error => {
        console.error('Chat submit error:', error);
      });
    }
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
    // Use the handleInputChange from useChat to update the input
    handleInputChange({ target: { value: prompt } } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <div
      className={`fixed ${topPosition} right-0 ${height} bg-fd-background border-l border-fd-border flex flex-col transition-all duration-300 ease-out z-50 ${
        isChatExpanded ? 'w-[70vw] z-[70]' : 'w-96'
      } ${
        isChatOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-fd-border bg-fd-background">
        <div className="flex items-center gap-2">
          <StackIcon size={18} className="text-fd-primary" />
          <div>
            <h3 className="font-medium text-fd-foreground text-sm">Stack Auth AI</h3>
            <p className="text-xs text-fd-muted-foreground">Documentation assistant</p>
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
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
          messages.map((message) => (
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
                    {message.content}
                  </div>
                ) : (
                  <MessageFormatter content={message.content} />
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-fd-muted text-fd-foreground border border-fd-border p-2 rounded-lg text-xs">
              <div className="flex items-center gap-1">
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1 h-1 bg-current rounded-full animate-bounce"></div>
                </div>
                <span className="ml-1">Thinking...</span>
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

      {/* Input */}
      <div className="border-t border-fd-border p-3">
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about Stack Auth..."
            className="flex-1 resize-none border border-fd-border rounded-md px-2 py-1 text-xs bg-fd-background text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-1 focus:ring-fd-primary focus:border-fd-primary"
            rows={1}
            style={{ minHeight: '32px', maxHeight: '96px' }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-2 py-1 bg-fd-primary text-fd-primary-foreground rounded-md text-xs hover:bg-fd-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <Send className="w-3 h-3" />
          </button>
        </form>
      </div>
    </div>
  );
}
