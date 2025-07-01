'use client';

import { useChat } from '@ai-sdk/react';
import { Bot, Send, User } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AIChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Prevent hydration mismatch by only rendering after client hydration
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Debug logging
  console.log('Messages:', messages);

  // Don't render until hydrated to prevent SSR/client mismatch
  if (!isHydrated) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 px-6 py-3 bg-muted/50 rounded-xl shadow-lg font-semibold animate-pulse">
            <Bot size={20} />
            Loading AI Assistant...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Toggle Button */}
      <div className="flex justify-center mb-8">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 font-semibold"
        >
          <Bot size={20} />
          {isOpen ? 'Hide AI Assistant' : 'Ask AI Assistant'}
        </button>
      </div>

      {/* Chat Interface */}
      {isOpen && (
        <div className="bg-card border border-border rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
            <Bot size={24} className="text-primary" />
            <h3 className="text-lg font-semibold">Stack Auth AI Assistant</h3>
            <span className="text-sm text-muted-foreground ml-auto">
              Ask questions about Stack Auth documentation
            </span>
          </div>

          {/* Messages Container */}
          <div className="h-96 overflow-y-auto mb-4 space-y-4 scroll-smooth">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Bot size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">Welcome to Stack Auth!</p>
                <p className="text-sm">
                  Ask me anything about authentication, documentation, or how to get started.
                </p>
              </div>
            )}

            {messages.map(message => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot size={16} className="text-primary" />
                  </div>
                )}
                
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground ml-auto'
                      : 'bg-muted'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </div>
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={16} />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot size={16} className="text-primary" />
                </div>
                <div className="bg-muted rounded-xl px-4 py-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              className="flex-1 px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-muted-foreground"
              value={input}
              placeholder="Ask about Stack Auth documentation..."
              onChange={handleInputChange}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
} 
