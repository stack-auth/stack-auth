'use client';

import { cn } from '@/lib/cn';
import { Check, Copy, Maximize2 } from 'lucide-react';
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

type CompactCodeblockProps = {
  code: string,
  language?: string,
  maxHeight?: string,
  className?: string,
}

export function CompactCodeblock({ code, language = 'tsx', maxHeight = '200px', className }: CompactCodeblockProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Update syntax highlighted code when code changes
  useEffect(() => {
    let isCancelled = false;

    const highlightCode = async () => {
      try {
        const html = await codeToHtml(code, {
          lang: language,
          theme: 'github-dark-default',
        });

        if (!isCancelled) {
          setHighlightedCode(html);
        }
      } catch (error) {
        console.error('Error highlighting code:', error);
        if (!isCancelled) {
          // Fallback to plain text wrapped in <pre>
          setHighlightedCode(`<pre><code>${code}</code></pre>`);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    highlightCode().catch((error) => {
      console.error('Error highlighting code:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [code, language]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((error) => {
      console.error('Failed to copy:', error);
    });
  };

  if (isLoading) {
    return (
      <div className={cn(
        'relative rounded-lg bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs overflow-hidden',
        className
      )}>
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]">
          <span className="text-[#7d8590] text-xs font-mono">{language}</span>
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-[#21262d] rounded transition-colors"
            title="Copy code"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
        <div className="p-3">
          <div className="animate-pulse">
            <div className="h-4 bg-[#21262d] rounded mb-2"></div>
            <div className="h-4 bg-[#21262d] rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'relative group',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between bg-fd-muted/30 px-2 py-1 border border-fd-border rounded-t-md">
        <span className="text-xs text-fd-muted-foreground font-mono">{language}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-fd-muted/60 rounded text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-fd-muted/60 rounded text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Code content */}
      <div
        className="relative overflow-hidden border border-t-0 border-fd-border rounded-b-md bg-[#0a0a0a]"
        style={{
          maxHeight: isExpanded ? '400px' : maxHeight,
          transition: 'max-height 0.3s ease-out',
        }}
      >
        <div
          className="overflow-auto h-full compact-codeblock-scrollbar"
          style={{
            // Firefox scrollbar styles
            scrollbarWidth: 'thin',
            scrollbarColor: '#404040 transparent',
          }}
        >
          <div
            className="p-3 text-xs leading-relaxed [&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0"
            style={{
              background: '#0a0a0a !important',
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>

        {/* Fade overlay when collapsed and content overflows */}
        {!isExpanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#0a0a0a] to-transparent pointer-events-none"
            style={{
              background: 'linear-gradient(to top, #0a0a0a 0%, transparent 100%)',
            }}
          />
        )}
      </div>
    </div>
  );
}
